/**
 * e2e 运行时的 node / CLI 解析（playwright.config.ts 与 playwright.local.config.ts 共用）
 *
 * 为什么需要它：
 * - better-sqlite3 按 Node ABI 编译，node_modules 里的产物若是 Node 22 ABI(127)，
 *   而当前 node 是 24（ABI 137），服务端 webServer 会在 new Database() 时抛 ERR_DLOPEN_FAILED。
 * - rollup 也可能因 NAPI prebuild 在某些 Node 版本上整进程 0xC0000135（vitest/vite 都依赖它）。
 *
 * 策略：NODE22_BIN → scripts/node-compat.mjs 探针 → 当前 node。
 * 探针不可用时退回 process.execPath —— CI 用 setup-node 装的就是可用版本。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * 从 cwd 向上找到仓库根（含 pnpm-workspace.yaml 的那层）。
 * 不依赖 __dirname / import.meta：Playwright 用 babel 把 .ts 配置转成 CJS，
 * import.meta 会直接抛错，而 __dirname 指向转译产物目录（不可靠）。
 */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

/** 选一个能同时跑工具链与原生模块的 node。 */
export function resolveNodeBin(root: string = findRepoRoot()): string {
  const explicit = process.env.NODE22_BIN;
  if (explicit && existsSync(explicit)) return explicit;

  const probe = spawnSync(process.execPath, [join(root, 'scripts', 'node-compat.mjs')], {
    encoding: 'utf8',
    timeout: 60_000,
    cwd: root,
  });
  if (probe.status === 0) {
    try {
      const parsed = JSON.parse(probe.stdout) as { nodeBin?: string | null };
      if (parsed.nodeBin && existsSync(parsed.nodeBin)) return parsed.nodeBin;
    } catch {
      // 探针输出异常 → 继续兜底
    }
  }
  return process.execPath;
}

/**
 * 解析 CLI 入口：先看包内 node_modules（isolated linker），再看根 node_modules（hoisted linker）。
 * 本仓 .npmrc 用 node-linker=hoisted，两处都兜住可避免布局变更后 e2e 静默失效。
 */
export function resolveCli(root: string, pkgDir: string, ...relatives: string[]): string {
  for (const rel of relatives) {
    for (const base of [join(root, pkgDir, 'node_modules'), join(root, 'node_modules')]) {
      const candidate = join(base, rel);
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`无法定位 CLI 入口：${pkgDir} -> ${relatives.join(' | ')}`);
}
