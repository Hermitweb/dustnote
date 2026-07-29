/**
 * 确保 web/node_modules/react 是指向 pnpm 虚拟 store 中 react@18.3.1 的 junction。
 *
 * 背景：pnpm hoisted node-linker 下，根目录 react(18.2.0, 来自 mobile)与
 * web/node_modules/react(物理 18.3.1) 共存。react-dom 经 pnpm store 解析时会
 * 配对 .pnpm/react@18.3.1，其内部 require('react') 拿到 store 的 react，与组件
 * 用的 web 物理 react 是不同实例 → ReactSharedInternals 不一致 → useState 崩溃。
 *
 * 把 web/node_modules/react 替换为指向 .pnpm/react@18.3.1/node_modules/react 的
 * junction，让组件与 react-dom 共享同一物理 react 实例。
 *
 * 在 vitest 运行前由 pretest 脚本调用；pnpm install 后会还原为物理目录，需重跑。
 */
/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');

const webReact = path.resolve(__dirname, '..', 'node_modules', 'react');
const storeReact = path.resolve(
  __dirname,
  '..',
  '..',
  'node_modules',
  '.pnpm',
  'react@18.3.1',
  'node_modules',
  'react'
);

if (!fs.existsSync(storeReact)) {
  // pnpm store 路径不在（非 pnpm 环境 / 版本变化）——跳过，依赖 vitest 的 dedupe。
  console.log('[ensure-react-junction] 未找到 pnpm store react@18.3.1，跳过。');
  process.exit(0);
}

// 已是 junction/symlink 则无需处理。
try {
  const stat = fs.lstatSync(webReact);
  if (stat.isSymbolicLink()) {
    console.log('[ensure-react-junction] web/node_modules/react 已是符号链接，跳过。');
    process.exit(0);
  }
} catch {
  // react 不存在，让 pnpm 处理。
  console.log('[ensure-react-junction] web/node_modules/react 不存在，跳过。');
  process.exit(0);
}

// 当前是物理目录，备份后替换为 junction。
const backup = webReact + '.physical.bak';
if (fs.existsSync(backup)) {
  fs.rmSync(backup, { recursive: true, force: true });
}
fs.renameSync(webReact, backup);

try {
  fs.symlinkSync(storeReact, webReact, 'junction');
  console.log('[ensure-react-junction] 已将 web/node_modules/react 链接到 pnpm store react@18.3.1。');
} catch (err) {
  // 链接失败则还原物理目录，避免破坏构建。
  console.error('[ensure-react-junction] 创建 junction 失败，还原物理目录：', err.message);
  fs.renameSync(backup, webReact);
  process.exit(0);
}

// 删除备份（junction 已生效）。
fs.rmSync(backup, { recursive: true, force: true });
console.log('[ensure-react-junction] 完成。');
