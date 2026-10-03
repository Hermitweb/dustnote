#!/usr/bin/env node
/**
 * 发版版本号统一 bump（替代手工 sed 26 文件的漏网地狱）
 *
 * 背景（发版纪律）：版本号散布约 23 个文件，历史上漏 bump 直接烧掉一轮 CI
 * （v2.5.34：hook 拦截 sed 后只提交 7 个 Edit，20 个配置文件静默漏网，
 * CI Create Release 的 tag-vs-package 一致性检查才暴露）。本脚本把清单
 * 固化进代码，跑完自动全仓验证残留，杜绝同类事故。
 *
 * 用法：
 *   node scripts/bump-version.mjs <new-version> [--from <old>] [--dry-run]
 * 示例：
 *   node scripts/bump-version.mjs 2.5.44
 *
 * 完成后仍需人工处理（脚本会打印提醒）：
 *   1. CHANGELOG.md 新增条目（发版说明需要人写）
 *   2. pnpm install 刷 lockfile（如 package.json 依赖段无变化则通常无 diff）
 *   3. git commit + tag + push（tag 必须打在 bump 提交之后）
 *
 * 自检：替换结束后全仓 grep 旧版本号（排除 CHANGELOG 历史/dist/node_modules），
 * 任何残留即报错退出——清单外的出现位置会被显式暴露而不是静默漏掉。
 */
import { readFileSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeBlock, stripProbeBlock, normalizeStatusPage } from './status-page.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 版本字符串替换清单（v2.5.42/2.5.43 两次发版实测收敛的完整集合）──────────
const VERSION_FILES = [
  'package.json',
  'client-core/package.json',
  'desktop/package.json',
  'miniprogram/package.json',
  'mobile/package.json',
  'server/package.json',
  'shared/package.json',
  'web/package.json',
  'site/package.json',
  // 官网 index.html 里 [data-slot=version] 的**静态兜底文本**：JS 跑起来之前，
  // 无脚本用户看的就是它。不纳入清单它会永远停在上一版。
  'site/index.html',
  'desktop/src-tauri/tauri.conf.json',
  'desktop/src-tauri/Cargo.toml',
  'desktop/src-tauri/Cargo.lock',
  'docker-compose.yml',
  '.env.example',
  'server/.env.example',
  'README.md',
  // docs/status.md **不在**本清单：它含探针生成区（status-probe:start/end），
  // 全局 split/join 会连"最近拨测：… 期望版本 v旧 / 线上 **v旧**"一起改写——
  // v2.5.47 发版实测：页面因此声称"探针判定线上已是 2.5.47"，而线上还在跑 2.5.46。
  // 它走下面的专用处理（只归一渠道表，生成区逐字节保留，见 scripts/status-page.mjs）。
  // 源码内 APP_VERSION / 默认值（脚本写文件不受编辑器 sed 纪律限制，统一在此收口）
  'server/src/env.ts',
  'miniprogram/src/state/auth.ts',
  'mobile/src/lib/version.ts',
  'web/public/sw.js',
  'deploy/deploy.sh',
  'deploy/install.sh',
];

// 不变量（把 v2.5.47 那次"发版把状态页刷成假绿"固化成会响的断言）：
// 生成区受保护的文件一旦混进全局替换清单，上面的 split/join 就会替探测说话。
if (VERSION_FILES.includes('docs/status.md')) {
  console.error('[中止] docs/status.md 不得进入 VERSION_FILES（生成区只能由探针写）');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fromIdx = args.indexOf('--from');
const NEW = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
if (!NEW) {
  console.error('用法: node scripts/bump-version.mjs <new-version> [--from <old>] [--dry-run]');
  process.exit(1);
}
const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const OLD_RAW = fromIdx >= 0 ? args[fromIdx + 1] : rootPkg.version;
/**
 * OLD 也要校验：它原先未经验证就拼进 `git grep -l "${OLD}"` 的 shell 命令行，
 * `--from 'x\" ; <cmd> ; #'` 等于任意命令执行（NEW 一直有正则校验，OLD 漏了）。
 * 下面还改成 execFileSync 传参数组——双保险，且不依赖引号技巧。
 */
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
if (!SEMVER_RE.test(String(OLD_RAW))) {
  console.error(`旧版本号不合法（需要 x.y.z）: ${JSON.stringify(OLD_RAW)}`);
  process.exit(1);
}
const OLD = String(OLD_RAW);
if (!/^\d+\.\d+\.\d+$/.test(OLD)) {
  console.error(`旧版本号非法: ${OLD}`);
  process.exit(1);
}
if (NEW === OLD) {
  console.error(`新旧版本相同: ${NEW}`);
  process.exit(1);
}
// 只允许 +1 递增或至少 patch/minor 前进，防手滑把版本改回历史值
const cmp = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};
if (cmp(NEW, OLD) <= 0) {
  console.error(`新版本必须大于旧版本: ${OLD} -> ${NEW}`);
  process.exit(1);
}

/**
 * 原子替换：先写同目录临时文件，再 rename 覆盖目标。
 *
 * 为什么不直接 writeFileSync 目标：那是"截断后重写"，中途崩溃/断电会留下半个
 * 文件——版本号清单里半个 package.json，下一次发版连 version 都读不出来。
 * rename 是原子的：目标要么全旧要么全新。
 *
 * 残余风险（已知、并写在这里而不是假装没有）：下面"写入前复核"与 rename 之间
 * 仍有微秒级窗口，彻底消除需要文件锁。但那是个假问题——本脚本是维护者单机跑的
 * 发布工具，要防的是**几秒前**编辑器/lint-staged 的意外保存（真发生过），
 * 不是微秒级竞争。复核留着是因为它对前一种情形有效。
 */
function writeFileAtomic(abs, content) {
  const tmp = `${abs}.bump-${process.pid}.tmp`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, abs);
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true }); // 失败时不留垃圾文件
  }
}

console.log(`bump ${OLD} -> ${NEW}${dryRun ? '（dry-run）' : ''}`);
let changed = 0;
const touched = [];

for (const rel of VERSION_FILES) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    console.error(`清单文件缺失: ${rel}`);
    process.exit(1);
  }
  const before = readFileSync(abs, 'utf8');
  if (!before.includes(OLD)) continue;
  const after = before.split(OLD).join(NEW);
  touched.push(rel);
  if (!dryRun) {
    /*
     * 写前复核：97 行读到的内容与磁盘当前内容不一致，说明中途有别人写过
     * （编辑器保存、lint-staged、并发的另一次 bump）。
     * 原先这里是无条件的读-改-写，会把对方的改动静默覆盖掉——
     * 版本号被回退这种事，宁可停下让人看一眼。
     */
    const now = readFileSync(abs, 'utf8');
    if (now !== before) {
      console.error(`[中止] ${rel} 在写入前已被其它进程改动，请确认后重跑（避免静默覆盖）`);
      process.exit(1);
    }
    writeFileAtomic(abs, after);
  }
  changed++;
}

// ── versionCode：build.gradle 整数 +1 ──────────────────────────────
const gradleRel = 'mobile/android/app/build.gradle';
const gradle = join(ROOT, gradleRel);
const gsrc = readFileSync(gradle, 'utf8');
const m = gsrc.match(/versionCode\s+(\d+)/);
if (!m) {
  console.error('build.gradle 未找到 versionCode');
  process.exit(1);
}
const nextCode = Number(m[1]) + 1;
let gnew = gsrc.replace(/(versionCode\s+)\d+/, `$1${nextCode}`);
// versionName 也必须在这里改——它曾被排除在 VERSION_FILES 之外（以为
// versionCode 段会一并处理），2.5.44 首次实战被自检抓出残留。
if (!gnew.includes(`versionName "${NEW}"`)) {
  gnew = gnew.replace(/versionName "\d+\.\d+\.\d+"/, `versionName "${NEW}"`);
}
if (!dryRun) writeFileAtomic(gradle, gnew);
if (!touched.includes(gradleRel)) touched.push(gradleRel);
console.log(`versionCode: ${m[1]} -> ${nextCode}`);

// ── status.md 特殊处理（P0-1 解耦后收窄）──────────────────────────────
//   发版脚本只允许写「客户端渠道表」——那是"我们发布了什么版本"的事实。
//   以前它还顺手归一"服务端 **vX**"与"最近人工核对：<今天>"，等于**没探测就把状态页刷绿**
//   （v2.5.43 发版时页面停在 2.5.40；后来更出现页头 🔴 而组件表全 🟢 的自相矛盾）。
//   "线上跑着什么"现在只能由 scripts/status-probe.mjs 写，且写进它的生成区标记内。
//   分区读写与回归测试在 scripts/status-page.mjs（这里不再自写正则——
//   v2.5.47 的教训正是"收窄"写在了通用替换之后，等于没收窄）。
const statusAbs = join(ROOT, 'docs/status.md');
const ssrc = readFileSync(statusAbs, 'utf8');
const { text: snew, changed: sChanged } = normalizeStatusPage(ssrc, NEW);
// 写盘前的兜底断言：生成区必须逐字节不变。变了就停——宁可发版中断，
// 不让页面出现"未来的线上版本"（那正是 issue #30 的来源形态）。
if (probeBlock(snew) !== probeBlock(ssrc)) {
  console.error('[中止] docs/status.md 的探针生成区被改写（发版动作不得替探测说话）');
  process.exit(1);
}
if (sChanged && !dryRun) writeFileAtomic(statusAbs, snew);
if (sChanged) touched.push('docs/status.md（仅客户端渠道表）');

// ── roadmap/ui 文档的「基线：vX」行归一（发版即刷新基线；两文档历史段
//   含旧版本号属正常叙事，进 RESIDUAL_ALLOW 文件级豁免）──
for (const rel of ['docs/roadmap.md', 'docs/ui-optimization.md']) {
  const abs = join(ROOT, rel);
  const src = readFileSync(abs, 'utf8');
  const out = src.replace(/基线：`?v?\d+\.\d+\.\d+`?/g, `基线：\`v${NEW}\``);
  if (out !== src) {
    if (!dryRun) writeFileAtomic(abs, out);
    touched.push(`${rel}（基线行）`);
  }
}

console.log(`\n已替换 ${changed} 个文件（versionCode 所在文件单独处理）:`);
for (const t of touched) console.log(`  ${t}`);

// ── 自检：全仓不得再有旧版本号（CHANGELOG 历史条目除外）────────────
// RESIDUAL_ALLOW：以**散文/测试夹具身份**合法引用任意版本号的文件——
// bump-version 自身复盘注释、roadmap/ui 复测记录段（改写=历史叙述说谎）；
// updater.test.ts 的夹具是**成对比较语义锚**（"2.6.0 > 2.5.45 = 升级"），
// 随版本漂移改写会破坏测试本意（v2.5.46 bump 实战判残留后沉淀）。
// 其余测试需要固定版本时一律用与仓库版本解耦的假版本号（api.test 2.99.0 先例）。
const RESIDUAL_ALLOW = [
  'scripts/bump-version.mjs',
  'docs/roadmap.md',
  'docs/ui-optimization.md',
  'desktop/src/lib/updater.test.ts',
  /*
   * 以下六处是**事故复盘的叙述文本**：它们提到 v2.5.46 是在说"那一次事故"，
   * 不是在声明当前版本。跟着 bump 一起改掉等于让历史说谎——本脚本把 roadmap /
   * ui-optimization 放进豁免，用的就是同一条理由。
   */
  '.github/workflows/ci.yml', // 注释：v2.5.46 服务器升级连挂两次的固化
  'Dockerfile', // 注释：v2.5.46 服务器升级连撞两次
  'CONTRIBUTING.md', // 门禁表里 docker:check 的来历
  'shared/README.md', // 注释：这条规矩的来历是升级现场连挂两次
  'scripts/check-docker-context.mjs', // 该守卫存在的理由就是那次事故
  'scripts/alert-drill.sh', // 讲 zip 文件名骗过 sort -V 的实例
  /*
   * 2026-10-03（2.5.47 部署阻断事故）新增的守卫与复盘，同上：注释与测试名里的
   * v2.5.47 是在讲"那次事故"，不是在声明当前版本。注意**测试夹具不在此列**——
   * 夹具里的版本号一律用与仓库解耦的假版本（status-page.test.mjs 的 2.0.0 / 7.7.7），
   * 不让每次发版都逼着人来改测试。
   */
  'deploy/upgrade.sh', // 自动回滚的动机 = 2.5.47 升级实录
  'scripts/status-page.mjs', // 分区读写的由来 = 2.5.47 发版改写了生成区
  'scripts/status-page.test.mjs', // 同上（头注释讲事故）
  'scripts/compose-ports.mjs', // 端口冲突判定的由来 = 2.5.47 双绑
  'scripts/compose-ports.test.mjs', // 同上（测试名里写着那次事故）
  'scripts/check-compose-ports.mjs', // 同上（门禁注释）
];
if (!dryRun) {
  // execFileSync + 参数数组：命令内容不再经过 shell，OLD 也就无从"越狱"
  let grepOut = '';
  try {
    grepOut = execFileSync(
      'git',
      // 必须 -F：不带的话 git grep 按 BRE 解释，`.` 是通配符。
      // v2.5.47 bump 实战：`2.5.46` 匹配上了 pinned action 的 SHA
      // `actions/setup-node@a0853c24544627...`（2·5·46 对上 245446），
      // 于是一条与版本毫无关系的 workflow 被判成残留、发版卡住。
      ['grep', '-l', '-F', OLD, '--', '.', ':(exclude)CHANGELOG.md', ':(exclude)*.lock'],
      { cwd: ROOT, encoding: 'utf8' }
    );
  } catch (err) {
    // git grep 无匹配时退出码 1，属正常路径；其余错误照抛
    if (err.status !== 1) throw err;
  }
  const grep = grepOut
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((f) => !RESIDUAL_ALLOW.includes(f))
    /*
     * docs/status.md 只按「生成区之外」判残留：
     * - 生成区里的旧版本号是**拨测时刻的历史记录**（"最近拨测：… 期望版本 v旧"），
     *   发版脚本不许改写它（见上方专用处理），出现在 grep 里不算漏改；
     * - 渠道表若漏改，下面这步会把它原样留下，照常 FAIL。
     */
    .filter(
      (f) =>
        f !== 'docs/status.md' || stripProbeBlock(readFileSync(join(ROOT, f), 'utf8')).includes(OLD)
    );
  // 注意：filter 后是数组——`if ([])` 恒真，必须显式判长度
  // （v2.5.45 bump 实战暴露：零残留也报 FAIL）
  if (grep.length > 0) {
    console.error(
      `\n[FAIL] 以下文件仍残留 ${OLD}（清单外出现位置，需人工确认后补进清单或改写）:\n${grep}`
    );
    process.exit(1);
  }
}

// ── CHANGELOG 提示 ─────────────────────────────────────────────────
const cl = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
if (!cl.includes(`## [${NEW}]`)) {
  console.log(`\n提醒: CHANGELOG.md 尚无 [${NEW}] 条目——请人工撰写后一并提交。`);
}
console.log(
  dryRun
    ? '\ndry-run 完成，未写盘。'
    : `\n完成。后续：人工写 CHANGELOG → pnpm install → git add -A && git commit → tag v${NEW} → push。`
);
