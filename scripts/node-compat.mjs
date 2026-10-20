// Node 24 / 22 兼容探针：决定跑工具链（vitest/vite/rollup）与服务端（better-sqlite3）用哪个 node bin。
//
// 背景（两个独立的 Node 24 障碍）：
//   1. rollup 4.x 的 win32-x64-msvc NAPI prebuild 在 Node 24 下调用 native_js.parse(input, bool, bool)
//      时 NAPI 层布尔转换损坏，整进程 0xC0000135 崩。vitest（依赖 rollup）在 Node 24 下跑不动。
//   2. better-sqlite3 是原生模块，按 Node ABI 编译。node_modules 里若是 Node 22 ABI(127) 产物，
//      而当前 node 是 24（ABI 137），加载直接抛 ERR_DLOPEN_FAILED → 所有 DB 集成测试崩。
//
// 两个障碍都指向同一个结论：工具链与服务端都需要 Node 22。故本探针把两者合并为一个自检。
//
// 本探针输出 JSON { nodeBin, version, reason, selfCheck, checks }：
//   - 当前 node 能同时加载 rollup 与 better-sqlite3 → 用当前 node（Node 22 / 或未来修好的 Node 24）
//   - 不能 → 在候选列表里找可用的 Node 22
//
// 用法：
//   node scripts/node-compat.mjs
//   DUSTNOTE_NODE22=C:\path\to\node22.exe node scripts/node-compat.mjs
//
// 约定：nodeBin 为 null 表示「没找到可用的 node」，此时调用方应自行决定兜底策略。

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** 自检要加载的模块：工具链（rollup）+ 服务端原生模块（better-sqlite3）。 */
const REQUIRED_MODULES = ['rollup', 'better-sqlite3'];

/** 列出目录下符合 pattern 的条目名（不存在则返回空）。 */
function listDirs(dir, pattern) {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((n) => (pattern ? pattern.test(n) : true))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * 候选 Node 22 二进制。按「通用优先」排序——环境变量 → 常见版本管理器 →
 * hermesagent 内置 runtime。任何一项都不是必需的：当前 node 通过自检时根本不会用到候选。
 */
function candidateNodeBins() {
  const out = [];
  const push = (p) => {
    if (p && !out.includes(p)) out.push(p);
  };

  // 1. 显式覆盖（最高优先级）
  push(process.env.DUSTNOTE_NODE22);

  // 2. hermesagent 内置 runtime（%APPDATA% 随用户变化，故不写死绝对路径）
  if (process.env.APPDATA) {
    const versions = join(process.env.APPDATA, 'cn.org.hermesagent.desktop', 'runtime', 'versions');
    for (const v of listDirs(versions)) {
      push(join(versions, v, 'node', 'node.exe'));
    }
  }

  // 3. nvm-windows
  if (process.env.NVM_HOME) {
    for (const v of listDirs(process.env.NVM_HOME, /^v22\./)) {
      push(join(process.env.NVM_HOME, v, 'node.exe'));
    }
  }

  // 4. nvm（类 Unix）
  if (process.env.NVM_DIR) {
    const base = join(process.env.NVM_DIR, 'versions', 'node');
    for (const v of listDirs(base, /^v22\./)) {
      push(join(base, v, 'bin', 'node'));
    }
  }

  // 5. fnm
  if (process.env.FNM_DIR) {
    const base = join(process.env.FNM_DIR, 'node-versions');
    for (const v of listDirs(base, /^v22\./)) {
      push(join(base, v, 'installation', 'node.exe'));
    }
  }

  return out;
}

/**
 * 子进程自检：能否 require 全部 REQUIRED_MODULES，且原生模块能真正初始化。
 *
 * 注意：better-sqlite3 的 .node 绑定是**惰性加载**的——`require('better-sqlite3')` 本身
 * 在 ABI 不匹配时也能成功，只有 `new Database()` 才会抛 ERR_DLOPEN_FAILED。
 * 因此自检必须真的开一个 :memory: 库，否则 Node ABI 不匹配会被漏检。
 *
 * 只有 exit 0 算可用。0xC0000135（3221225477 / 负值）/ SIGSEGV / 2 都视为不可用。
 */
function selfCheck(nodeBin) {
  const script = `try{${REQUIRED_MODULES.map((m) => `require(${JSON.stringify(m)})`).join(
    ';'
  )};new (require('better-sqlite3'))(':memory:').close();process.exit(0)}catch{process.exit(2)}`;
  const r = spawnSync(nodeBin, ['-e', script], {
    encoding: 'utf8',
    timeout: 30000,
    cwd: ROOT,
  });
  return {
    ok: r.status === 0,
    exit: r.status,
    signal: r.signal,
    timedOut: r.timedOut,
    modules: REQUIRED_MODULES,
  };
}

function versionOf(nodeBin) {
  const r = spawnSync(nodeBin, ['--version'], { encoding: 'utf8' });
  return (r.stdout || '').trim() || '';
}

function emit(payload, exitCode) {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  process.exit(exitCode);
}

function main() {
  const cur = selfCheck(process.execPath);
  if (cur.ok) {
    emit(
      {
        nodeBin: process.execPath,
        version: versionOf(process.execPath),
        reason: 'current node passes the toolchain + native module self-check',
        selfCheck: cur,
        checks: { current: cur },
      },
      0
    );
    return;
  }

  for (const c of candidateNodeBins()) {
    if (!existsSync(c)) continue;
    const v = versionOf(c);
    if (!/^v22\./.test(v)) continue;
    const chk = selfCheck(c);
    if (chk.ok) {
      emit(
        {
          nodeBin: c,
          version: v,
          reason: 'current node failed the self-check; falling back to a Node 22 candidate',
          selfCheck: { current: cur, fallback: chk },
          checks: { current: cur, fallback: chk },
        },
        0
      );
      return;
    }
  }

  emit(
    {
      nodeBin: null,
      version: versionOf(process.execPath),
      reason:
        'current node failed the self-check and no usable Node 22 candidate was found. ' +
        'Set DUSTNOTE_NODE22 to a Node 22 binary, or reinstall native modules ' +
        '(pnpm rebuild better-sqlite3) for the current Node version.',
      selfCheck: cur,
      checks: { current: cur },
    },
    1
  );
}

main();
