#!/usr/bin/env node
/**
 * 环境变量清单守卫（pnpm env:check）
 *
 * 起因：整理时发现 .env.example 与代码实际读取的变量对不上——BACKUP_DIR、
 * DOWNLOADS_DIR、FIELD_ENCRYPTION_KEY、NTFY_TOPIC 等都没登记。这类缺口的表现
 * 不是「构建失败」，而是「照文档装完服务器，某个功能静默走默认值」：
 * 备份写到没被挂载的目录、字段加密悄悄回退用 JWT_SECRET 派生。
 * 部署清单是人手抄的，一定会漂；从代码里读就不会。
 *
 * 它做两件事（任一失败 exit 1）：
 *  1. 代码/compose 里读到的每个 env 名，必须在 .env.example 出现，
 *     或出现在 RUNTIME_VARS 里并写明「为什么不该写进部署清单」；
 *  2. .env.example 里声明的每个名字，必须真的被读到——
 *     没人读的变量是文档噪音，比缺一个更坏（它会让人以为开关存在）。
 *
 * 只扫 Node 侧（server / scripts / deploy / Dockerfile / compose）：
 * 浏览器端跑不出 process.env，那边是 import.meta.env，语义完全不同。
 * 不扫 shell 脚本：${VAR} 在 shell 里既可能是环境变量也可能是局部变量，
 * 不做真正的赋值流分析就分不清（第一版把 MON_DIR/AFTER 这类局部变量也报成缺口，
 * 64 条噪音）。deploy.sh / alert-drill.sh 的入参由它们自己的 --help 与文档负责。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEP = String.fromCharCode(92); // 路径分隔符，测试里也用它

/** 扫描范围：真正会读环境变量的地方 */
export const SCAN_DIRS = ['server/src', 'server/scripts', 'scripts', 'deploy'];
export const SCAN_FILES = [
  'docker-compose.yml',
  'Dockerfile',
  'deploy/Caddyfile',
  'deploy/nginx.conf',
];
// 不含 .sh/.ps1：见文件头「不扫 shell 脚本」那条边界说明
const FILE_RE = /\.(ts|js|mjs|cjs|yml|yaml)$/;
/**
 * 由 CI / 容器运行时 / Node 自己注入，或只在测试与演练里设——不该出现在部署清单里。
 * 每一条都要写理由：没有理由的条目就是这条守卫开始漏的地方。
 */
export const RUNTIME_VARS = {
  NODE_ENV: 'Node/框架内置；compose 已写死，用户不必配',
  CI: 'GitHub Actions 注入，用于把探针失败转成 workflow 错误',
  GITHUB_TOKEN: 'Actions 自动注入的作业令牌，不是部署配置',
  GITHUB_RUN_ID: 'Actions 注入，用于告警里回链到具体 run',
  GITHUB_REPOSITORY: 'Actions 注入',
  GITHUB_API_URL: 'Actions 注入（企业版会改）',
  GITHUB_SERVER_URL: 'Actions 注入',
  PATH: '操作系统提供',
  HOME: '操作系统提供',
  TMPDIR: '操作系统提供，测试造临时目录时用',
  STATUS_PROBE_URL: '拨测目标；CI 用它在本地假服务器上跑回归，生产走默认值',
  EXPECT_VERSION: '拨测期望版本，由 CI 从 package.json 注入，避免两处手写漂',
  ALERT_DRILL: 'alert-drill.sh 的演练开关，运维临时量，不是常驻配置',
  STATUS_PROBE_PLAINTEXT_URLS:
    '拨测明文收口的目标端口覆盖；只在非 80/8080 的前置代理部署或回归测试里指路',
  TZ: '容器时区，compose 里已设',
};

/**
 * 从一份源码/compose 文本里抽出被读取的 env 名。纯函数，测试直接打这里。
 *
 * kind 决定要不要认 ${VAR{'}'} 插值：TS/JS 里的 ${PREFIX{'}'} 是模板字符串插值，
 * 与环境变量毫无关系——第一版不分 kind，把 password.ts 的 ${NEW_N{'}'}、totp.ts 的
 * ${DIGITS{'}'} 全报成「代码读了但清单没登记」，31 条里 10 条是这种假阳性。
 * 只有 yml / Dockerfile / Caddyfile / conf 才是插值语义。
 */
export function envNamesIn(text, kind) {
  const names = new Set();
  const pats = [
    /process\.env\.([A-Z][A-Z0-9_]{2,})/g, // 点号写法
    /process\.env\[\s*['"]([A-Z][A-Z0-9_]{2,})['"]\s*\]/g, // 方括号写法
    /getEnv(?:Opt)?\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g, // server/src/env.ts 的集中读法
  ];
  if (kind === 'interp') {
    pats.push(/[$][{]([A-Z][A-Z0-9_]{2,})(?::[^}]*)?[}]/g); // 变量插值：dollar 加大括号的 VAR，以及 VAR:-默认值
  }
  for (const re of pats) for (const m of text.matchAll(re)) names.add(m[1]);
  return names;
}

/**
 * 去掉整行注释（yml / compose / Dockerfile / Caddyfile 里 {VAR} 常出现在说明文字里）。
 *
 * 只认「行首可选空白 + #」，不切行内 {——那会把 "a#b" 这类值里的 # 后内容也吞掉。
 * 第一版没做这一步，compose.monitoring.yml 的说明行 主栈发布在 ... 被当成真实读取，
 * 报出 PORT 与 METRICS_TOKEN 两条假缺口。
 */
export function stripLineComments(text) {
  return text
    .split(/\r?\n/)
    .map((l) => (/^\s*#/.test(l) ? '' : l))
    .join('\n');
}

/** 按文件类型决定语义：只有配置类文件里的 ${VAR} 才是环境变量插值。 */
export function kindOf(file) {
  return /[.](yml|yaml|conf)$/i.test(file) || /(Dockerfile|Caddyfile)/i.test(file)
    ? 'interp'
    : 'code';
}

/** .env.example 里声明的变量名（注释掉的也算声明——它是清单，不是 shell）。 */
export function declaredInExample(text) {
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*#?\s*([A-Z][A-Z0-9_]{2,})\s*=/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

function walk(dir, out) {
  let st;
  try {
    st = statSync(join(ROOT, dir));
  } catch {
    return; // 目录不存在就跳过（例如 server/scripts 可能被删）
  }
  if (!st.isDirectory()) return;
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) {
      if (/(node_modules|dist|build|\.turbo|\.cache|coverage|target)/.test(e.name)) continue;
      walk(rel, out);
    } else if (FILE_RE.test(e.name)) out.push(rel);
  }
}

/**
 * 按「部署面」分组：主栈与监控栈是两份清单、两次 cp .env，
 * 混在一起查会把 NTFY_TOPIC 报成主栈缺口（它其实登记在
 * deploy/monitoring/.env.monitoring.example 里）。
 */
export const SCOPES = [
  {
    name: '主栈',
    manifest: '.env.example',
    dirs: ['server/src', 'server/scripts', 'scripts'],
    files: ['docker-compose.yml', 'Dockerfile', 'deploy/Caddyfile', 'deploy/nginx.conf'],
    // deploy 根下的脚本属于主栈，但 deploy/monitoring 属于监控栈
    fileFilter: (f) => !f.startsWith('deploy' + SEP + 'monitoring'),
  },
  {
    name: '监控栈',
    manifest: 'deploy/monitoring/.env.monitoring.example',
    dirs: ['deploy/monitoring'],
  },
];

export function collect() {
  const scopes = [];
  for (const sc of SCOPES) {
    const files = [];
    for (const d of sc.dirs || []) walk(d, files);
    for (const f of sc.files || []) files.push(f);
    const picked = sc.fileFilter ? files.filter(sc.fileFilter) : files;
    const used = new Map();
    for (const f of picked) {
      let text;
      try {
        text = readFileSync(join(ROOT, f), 'utf8');
      } catch {
        continue;
      }
      for (const n of envNamesIn(
        kindOf(f) === 'interp' ? stripLineComments(text) : text,
        kindOf(f)
      )) {
        if (!used.has(n)) used.set(n, []);
        const list = used.get(n);
        if (!list.includes(f)) list.push(f);
      }
    }
    let declared = new Set();
    try {
      declared = declaredInExample(readFileSync(join(ROOT, sc.manifest), 'utf8'));
    } catch {
      console.error('[FAIL] 清单文件读不到：' + sc.manifest);
      process.exitCode = 1;
    }
    scopes.push({ name: sc.name, manifest: sc.manifest, files: picked, used, declared });
  }
  return scopes;
}

function main() {
  const asJson = process.argv.includes('--json');
  const scopes = collect();
  const problems = [];
  for (const sc of scopes) {
    for (const n of sc.used.keys()) {
      if (!sc.declared.has(n) && !Object.prototype.hasOwnProperty.call(RUNTIME_VARS, n))
        problems.push(
          sc.name +
            '：代码读了但 ' +
            sc.manifest +
            ' 没登记：' +
            n +
            '（' +
            (sc.used.get(n) || []).slice(0, 3).join(', ') +
            '）'
        );
    }
    for (const n of sc.declared) {
      if (!sc.used.has(n))
        problems.push(
          sc.name +
            '：' +
            sc.manifest +
            ' 声明了但没有任何代码读取：' +
            n +
            '（没人读的开关是文档噪音）'
        );
    }
  }
  if (asJson) {
    console.log(
      JSON.stringify(
        scopes.map((sc) => ({
          scope: sc.name,
          files: sc.files.length,
          used: [...sc.used.keys()],
          declared: [...sc.declared],
        })),
        null,
        2
      )
    );
    if (problems.length) process.exitCode = 1;
    return;
  }
  if (problems.length) {
    console.error('');
    console.error('[FAIL] 环境变量清单不一致：' + problems.length + ' 处');
    for (const pr of problems) console.error('  - ' + pr);
    console.error('');
    console.error('要么补进对应清单，要么进 RUNTIME_VARS 并写明为什么不该出现在部署清单里。');
    process.exitCode = 1;
    return;
  }
  const total = scopes.reduce((a, sc) => a + sc.used.size, 0);
  console.log(
    'OK：' +
      scopes.length +
      ' 个部署面共 ' +
      total +
      ' 个被读的 env 名，与各自行清单双向一致（扫 ' +
      scopes.reduce((a, sc) => a + sc.files.length, 0) +
      ' 个文件）'
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
