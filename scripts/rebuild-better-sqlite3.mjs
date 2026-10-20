#!/usr/bin/env node
/**
 * rebuild-better-sqlite3.mjs — 跨 Node 版本重编 better-sqlite3 原生模块。
 *
 * 背景：better-sqlite3 是原生模块，编译目标 = 编译时所用的 Node ABI（NODE_MODULE_VERSION）。
 *   - Node 22 → ABI 127；Node 24 → ABI 137。
 *   - node_modules 里只有一份 .node，跨版本切 node 就会 ERR_DLOPEN / NODE_MODULE_VERSION 不匹配。
 * 因此「Node 24 下跑全量测试」前，必须用 Node 24 重编一次。
 *
 * 本脚本：
 *   1. 检测当前 node 版本与 ABI；
 *   2. 检测 node_modules/better-sqlite3 现存 .node 的编译目标 ABI（读 package.json 的 node abi 或
 *      尝试 require 探测）；
 *   3. 不匹配时用 node-gyp 重编；匹配则跳过；
 *   4. 最后用当前 node require 验证。
 *
 * 用法：node scripts/rebuild-better-sqlite3.mjs
 * 依赖：node-gyp（npm 自带）+ VS2022 工具链。GitHub 不可达时 prebuild-install 失败，
 *       走源码 node-gyp 编译（本机已验证可行）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BSQL = join(ROOT, 'node_modules', 'better-sqlite3');
const NODE = process.execPath;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const curVer = run(NODE, ['--version']).out.trim();
const abi = run(NODE, ['-e', 'console.log(process.versions.modules)']).out.trim();
console.log(`[rebuild] 当前 node ${curVer} (ABI ${abi})`);

if (!existsSync(join(BSQL, 'package.json'))) {
  console.error('[rebuild] 未找到 node_modules/better-sqlite3，先 pnpm install');
  process.exit(2);
}

// 探测现存 .node 是否已匹配当前 ABI：直接 require，崩/报版本错即需重编
const probe = spawnSync(
  NODE,
  [
    '-e',
    `try{require(${JSON.stringify(join(BSQL, 'package.json'))});const D=require('better-sqlite3');new D(':memory:');process.exit(0)}catch(e){process.exit(e.code==='ERR_DLOPEN_FAILED'||/NODE_MODULE_VERSION/.test(e.message)?1:2)}`,
  ],
  { encoding: 'utf8' }
);
if (probe.status === 0) {
  console.log('[rebuild] better-sqlite3 已与当前 node 匹配，跳过编译 ✅');
  process.exit(0);
}

// 需要重编：找 node-gyp（优先 npm 自带）
const gypCandidates = [
  'C:\\Program Files\\nodejs\\node_modules\\npm\\node_modules\\node-gyp\\bin\\node-gyp.js',
  join(ROOT, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
];
const gyp = gypCandidates.find((p) => existsSync(p));
if (!gyp) {
  console.error(
    '[rebuild] 找不到 node-gyp（npm 自带 / 本地），无法源码重编。请 pnpm install 或装 node-gyp。'
  );
  process.exit(3);
}

console.log('[rebuild] 用 node-gyp 重编 better-sqlite3（源码，GitHub 不可达时走此路径）...');
const t0 = Date.now();
const build = run(NODE, [gyp, 'rebuild', '--release', '--directory=' + BSQL], { cwd: BSQL });
if (build.status !== 0) {
  console.error('[rebuild] node-gyp 失败：' + build.out.slice(-800));
  process.exit(4);
}
console.log(`[rebuild] node-gyp 完成（${((Date.now() - t0) / 1000).toFixed(1)}s）`);

// 重验
const v = spawnSync(
  NODE,
  [
    '-e',
    `const D=require('better-sqlite3');const db=new D(':memory:');db.exec('CREATE TABLE t(x)');console.log('OK: '+db.prepare('SELECT ? AS v').get('rebuilt-'+${JSON.stringify(abi)}));db.close()`,
  ],
  { encoding: 'utf8' }
);
if (v.status === 0) {
  console.log(
    '[rebuild] ✅ better-sqlite3 已为 Node ' +
      curVer +
      ' (ABI ' +
      abi +
      ') 重编并验证：' +
      v.stdout.trim()
  );
  process.exit(0);
} else {
  console.error('[rebuild] 重编后仍无法加载：' + ((v.stdout || '') + (v.stderr || '')).slice(-300));
  process.exit(5);
}
