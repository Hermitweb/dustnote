#!/usr/bin/env node
/**
 * 覆盖率门禁（test-orchestrate 内部 step）
 *
 * 目标：跑完 `pnpm test:coverage` 后，把各子项目 v8 覆盖率报告聚合，
 *       与「90% lines / 90% statements / 75% functions / 80% branches」工业级目标比对，
 *       不达标即 exit 1。
 *
 * 与 vitest 自身 thresholds 的差异：
 *   - vitest thresholds 一旦某个子项目不达标就阻断后续；
 *   - 本脚本会跑完所有子项目再汇总，便于看到完整缺口地图。
 *
 * 数据源：每个子项目 coverage/coverage-final.json（v8 reporter）。
 *
 * 用法：
 *   node scripts/coverage-gate.mjs              # 默认 90/90/75/80 阈值
 *   node scripts/coverage-gate.mjs --lines 95   # 允许折让
 *   node scripts/coverage-gate.mjs --lines 100 --statements 100 --functions 100 --branches 100  # 严格 100%
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

// 默认 90% lines（全仓聚合的工业级门禁）；--lines 可覆盖
const REQUIRED = { lines: 90, statements: 90, functions: 75, branches: 80 };
for (const key of Object.keys(REQUIRED)) {
  const idx = argv.indexOf(`--${key}`);
  if (idx >= 0 && argv[idx + 1]) {
    const v = Number(argv[idx + 1]);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      process.stderr.write(`--${key} 期望 0-100 数字，得到 ${argv[idx + 1]}\n`);
      process.exit(2);
    }
    REQUIRED[key] = v;
  }
}
const JSON_OUT = argv.includes('--json');

/**
 * 巨型组件豁免（口径决策：web 90% 门禁只算可单测部分）。
 *
 * 这些 web 组件依赖 TipTap + IndexedDB + Web Crypto + worker 全链路，
 * jsdom 跑不动，改由 Playwright E2E 兜底（e2e/*.spec.ts 真实 server + 浏览器）。
 * 列在这里的文件在 gate 的 web 分子/分母中**整体排除**——既不计入覆盖、
 * 也不计入未覆盖，避免把「只能 E2E 测」的组件算成 web 单测门禁的 0% 缺口。
 * 按 basename 匹配（跨绝对/相对路径都稳）。
 *
 * 注意：豁免只影响「门禁判定」，不影响 bottom 缺口地图展示（仍列出供参考）。
 */
const E2E_EXCLUDED_BASENAMES = new Set([
  'App.tsx',
  'Editor.tsx',
  'NoteList.tsx',
  'SettingsDialog.tsx',
  'Sidebar.tsx',
  'WysiwygEditor.tsx',
  'argon2-worker.ts',
  'sync-ws.ts',
  // server 入口 / 启动配置校验（由 Playwright E2E 兜底）
  'index.ts',
  'config-validate.ts',
]);

/** basename 匹配豁免。 */
function isExcluded(file) {
  const base = file.replace(/\\/g, '/').split('/').pop() || '';
  return E2E_EXCLUDED_BASENAMES.has(base);
}

/** 查找子项目的 coverage-final.json。 */
function discoverReports() {
  const out = [];
  const candidates = [
    'server',
    'web',
    'mobile',
    'desktop',
    'miniprogram',
    'shared',
    'client-core',
    'site',
  ];
  for (const dir of candidates) {
    const cov = join(ROOT, dir, 'coverage', 'coverage-final.json');
    if (existsSync(cov)) out.push({ name: dir, path: cov });
  }
  // 也支持 root / e2e
  for (const extra of ['.', 'e2e']) {
    const cov = join(ROOT, extra, 'coverage', 'coverage-final.json');
    if (existsSync(cov)) out.push({ name: extra, path: cov });
  }
  return out;
}

/**
 * 把 v8 coverage 的 key 映射成标准指标。
 *  v8 输出: { statementMap, fnMap, branchMap, s, f, b, _coverageSchema }
 *  聚合公式：
 *    lines = covered statements / total statements
 *    statements = 同上
 *    functions = covered fns / total fns
 *    branches = covered branches / total branches
 *
 *  excludeExcluded=true 时，跳过 E2E 豁免文件（巨型组件）——分子分母都不计入。
 */
function summarize(report, { excludeExcluded = false } = {}) {
  const keys = Object.keys(report).filter((k) => k !== '_coverageSchema');
  let sTotal = 0,
    sCovered = 0,
    fTotal = 0,
    fCovered = 0,
    bTotal = 0,
    bCovered = 0;
  for (const f of keys) {
    if (excludeExcluded && isExcluded(f)) continue;
    const e = report[f];
    if (e.s) {
      const st = Object.keys(e.s);
      sTotal += st.length;
      sCovered += st.filter((k) => e.s[k] > 0).length;
    }
    if (e.f) {
      const ft = Object.keys(e.f);
      fTotal += ft.length;
      fCovered += ft.filter((k) => e.f[k] > 0).length;
    }
    if (e.b) {
      for (const arr of Object.values(e.b)) {
        bTotal += arr.length;
        bCovered += arr.filter((n) => n > 0).length;
      }
    }
  }
  const pct = (a, b) => (b === 0 ? 100 : (a / b) * 100);
  return {
    statements: pct(sCovered, sTotal),
    branches: pct(bCovered, bTotal),
    functions: pct(fCovered, fTotal),
    lines: pct(sCovered, sTotal), // v8 不直接给 lines，用 statements 近似
    totals: { sTotal, sCovered, fTotal, fCovered, bTotal, bCovered },
  };
}

/** 找出覆盖率最低的源文件，便于补测试时排序。 */
function bottomFiles(report, n = 10) {
  const out = [];
  for (const [file, e] of Object.entries(report)) {
    if (file === '_coverageSchema') continue;
    const st = Object.keys(e.s || {});
    const total = st.length;
    if (total === 0) continue;
    const covered = st.filter((k) => e.s[k] > 0).length;
    out.push({ file, pct: (covered / total) * 100 });
  }
  return out.sort((a, b) => a.pct - b.pct).slice(0, n);
}

const reports = discoverReports();
const summary = [];
for (const r of reports) {
  const cov = JSON.parse(readFileSync(r.path, 'utf8'));
  // web 包：巨型组件归 E2E 兜底，不计入 90% 门禁分母（口径 a）
  const excludeExcluded = r.name === 'web';
  const s = summarize(cov, { excludeExcluded });
  const fail = Object.entries(REQUIRED).filter(([k, v]) => s[k] < v);
  const excludedFiles = excludeExcluded
    ? Object.keys(cov).filter((f) => f !== '_coverageSchema' && isExcluded(f))
    : [];
  summary.push({
    name: r.name,
    coverage: s,
    required: REQUIRED,
    pass: fail.length === 0,
    failed: fail.map(([k]) => k),
    bottom: bottomFiles(cov),
    e2eExcluded: excludedFiles,
  });
}

const failed = summary.filter((s) => !s.pass);

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ summary, failedCount: failed.length }, null, 2) + '\n');
} else {
  for (const s of summary) {
    const tag = s.pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    process.stderr.write(
      `\n${tag} ${s.name.padEnd(14)}  ` +
        `lines ${s.coverage.lines.toFixed(2)}%  ` +
        `stmts ${s.coverage.statements.toFixed(2)}%  ` +
        `funcs ${s.coverage.functions.toFixed(2)}%  ` +
        `branches ${s.coverage.branches.toFixed(2)}%  ` +
        `(req ${REQUIRED.lines}/${REQUIRED.statements}/${REQUIRED.functions}/${REQUIRED.branches})`
    );
    if (!s.pass) process.stderr.write(` 缺: ${s.failed.join(', ')}`);
    process.stderr.write('\n');
    if (s.e2eExcluded?.length) {
      process.stderr.write(
        `  E2E 豁免(不计门禁分母): ${s.e2eExcluded.map((f) => f.split('/').pop()).join(', ')}\n`
      );
    }
    if (!s.pass && s.bottom.length) {
      process.stderr.write('  缺口文件 Top10:\n');
      for (const b of s.bottom) {
        process.stderr.write(`    ${b.pct.toFixed(1).padStart(5)}%  ${b.file}\n`);
      }
    }
  }
  process.stderr.write(`\n=== 覆盖率门禁：${reports.length} 子项目，${failed.length} 不达标 ===\n`);
}

/**
 * server 覆盖说明（环境降级提示）：
 * server 的「真实」行覆盖必须跑在 Node 22 + better-sqlite3 可用的环境。
 * Node 24 下 better-sqlite3 原生模块 ABI 不匹配（ERR_DLOPEN_FAILED）→
 * 22 个 DB 集成测试文件全失败 → vitest 不写 coverage-final.json。
 * 缺 DB 时门禁读到的 server 报告退到仅非 DB 单测覆盖（~33%），属环境降级
 * 而非代码回归。自检：`node -e "new (require('better-sqlite3')(':memory:'))"`。
 */
/**
 * 探测 better-sqlite3 在当前 Node 下是否可用。
 *
 * 原生模块按 Node ABI 编译：node_modules 里若是 Node 22 ABI(127) 产物而当前 node 是 24
 * （ABI 137），加载会 ERR_DLOPEN_FAILED → 22 个 DB 集成测试文件全失败 → vitest 不写
 * coverage-final.json → 门禁读到的 server 覆盖退到仅非 DB 单测（~33%）。
 *
 * 必须在子进程里真开一个 :memory: 库：`require('better-sqlite3')` 本身是惰性加载的
 * （绑定在 new Database() 时才装载），只 require 测不出 ABI 不匹配。
 */
function dbUnavailable() {
  const r = spawnSync(
    process.execPath,
    [
      '-e',
      "try{new (require('better-sqlite3'))(':memory:').close();process.exit(0)}catch{process.exit(2)}",
    ],
    { encoding: 'utf8', timeout: 30_000, cwd: ROOT }
  );
  return r.status !== 0;
}

if (failed.some((f) => f.name === 'server')) {
  if (dbUnavailable()) {
    process.stderr.write(
      '\n  ⚠ server 不达标可能因 better-sqlite3 原生模块与当前 Node ABI 不匹配（环境降级，非代码回归）。'
    );
    process.stderr.write(
      '  请先 `pnpm rebuild better-sqlite3`（Node 22），再全量跑 server 测试生成覆盖。\n'
    );
  }
}

process.exit(failed.length > 0 ? 1 : 0);
