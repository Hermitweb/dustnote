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
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  'desktop/src-tauri/tauri.conf.json',
  'desktop/src-tauri/Cargo.toml',
  'desktop/src-tauri/Cargo.lock',
  'docker-compose.yml',
  '.env.example',
  'server/.env.example',
  'README.md',
  'docs/status.md',
  // 源码内 APP_VERSION / 默认值（脚本写文件不受编辑器 sed 纪律限制，统一在此收口）
  'server/src/env.ts',
  'miniprogram/src/state/auth.ts',
  'mobile/src/lib/version.ts',
  'web/public/sw.js',
  'deploy/deploy.sh',
  'deploy/install.sh',
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fromIdx = args.indexOf('--from');
const NEW = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
if (!NEW) {
  console.error('用法: node scripts/bump-version.mjs <new-version> [--from <old>] [--dry-run]');
  process.exit(1);
}
const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const OLD = fromIdx >= 0 ? args[fromIdx + 1] : rootPkg.version;
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
  if (!dryRun) writeFileSync(abs, after);
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
if (!dryRun) writeFileSync(gradle, gnew);
if (!touched.includes(gradleRel)) touched.push(gradleRel);
console.log(`versionCode: ${m[1]} -> ${nextCode}`);

// ── status.md 特殊处理：它记录「线上当前版本」，人手维护必然滞后
//   （v2.5.43 发版时它就停在 2.5.40）。只归一三类**精确模式**：
//   头部当前版本行 / 渠道表第二列 / 核对日期。历史事件段与 IP 一律不碰
//   （第一版用全局 \d+\.\d+\.\d+ 预览时把 154.217.234 和 v2.5.40 历史行
//   都改了——教训：对含 IP 的文档禁止宽泛数字替换）。──
const statusAbs = join(ROOT, 'docs/status.md');
const ssrc = readFileSync(statusAbs, 'utf8');
let snew = ssrc.replace(/服务端 \*\*v\d+\.\d+\.\d+\*\*/, `服务端 **v${NEW}**`);
snew = snew.replace(/(\|[^|\n]+\| )\d+\.\d+\.\d+( ?\|)/g, (_m, pre, post) => `${pre}${NEW}${post}`);
// 本地日期（toISOString 是 UTC，晚间发版会写错一天——2.5.44 实战发现）
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
  now.getDate()
).padStart(2, '0')}`;
snew = snew.replace(/最近人工核对：\d{4}-\d{2}-\d{2}/, `最近人工核对：${today}`);
if (snew !== ssrc && !dryRun) writeFileSync(statusAbs, snew);
if (snew !== ssrc) touched.push('docs/status.md（当前版本/渠道表/核对日期）');

// ── roadmap/ui 文档的「基线：vX」行归一（发版即刷新基线；两文档历史段
//   含旧版本号属正常叙事，进 RESIDUAL_ALLOW 文件级豁免）──
for (const rel of ['docs/roadmap.md', 'docs/ui-optimization.md']) {
  const abs = join(ROOT, rel);
  const src = readFileSync(abs, 'utf8');
  const out = src.replace(/基线：`?v?\d+\.\d+\.\d+`?/g, `基线：\`v${NEW}\``);
  if (out !== src) {
    if (!dryRun) writeFileSync(abs, out);
    touched.push(`${rel}（基线行）`);
  }
}

console.log(`\n已替换 ${changed} 个文件（versionCode 所在文件单独处理）:`);
for (const t of touched) console.log(`  ${t}`);

// ── 自检：全仓不得再有旧版本号（CHANGELOG 历史条目除外）────────────
// RESIDUAL_ALLOW：以**散文/历史叙事身份**合法引用任意旧版本号的文件——
// bump-version 自身的复盘注释、roadmap/ui 的复测记录段都属于此类
// （改写会让历史叙述变成说谎；v2.5.45 bump 实战首撞沉淀）。
// 其余文件（测试等）不得进清单：需要固定版本时用语义明确的假版本号。
const RESIDUAL_ALLOW = ['scripts/bump-version.mjs', 'docs/roadmap.md', 'docs/ui-optimization.md'];
if (!dryRun) {
  const grep = execSync(
    `git grep -l "${OLD}" -- . ":(exclude)CHANGELOG.md" ":(exclude)*.lock" || true`,
    { cwd: ROOT, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((f) => !RESIDUAL_ALLOW.includes(f));
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
