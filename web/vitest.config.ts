import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';

// 独立的 vitest 配置（不复用 vite.config.ts，避免 dev server proxy 干扰）。
// 定义与 vite.config.ts 一致的 __APP_VERSION__，让引用它的模块在测试中可加载。
//
// pnpm hoisted node-linker 下 react 可能被 hoist 到 workspace root，而 react-dom
// 通常是 web/node_modules 下的 junction，指向 .pnpm store 中与其配对的 react 同目录。
// 关键：react-dom 的 CJS 内部 require('react') 经 Node 原生解析会命中 store 配对 react，
// 而非 alias 指向的 react。因此 react alias 必须指向「与 react-dom 配对的同一份 react」，
// 才能让组件与 react-dom 共享同一 ReactSharedInternals，避免 useState 抛 "Cannot read null"。

/** 解析与 web 当前 react-dom 配对的 react 物理路径 */
function resolvePairedReact(): string {
  const reactDomLocal = resolve(__dirname, 'node_modules/react-dom');
  if (existsSync(reactDomLocal)) {
    try {
      // react-dom 真实路径的上一级即 pnpm store 中与它配对的 react 所在目录
      const realReactDom = realpathSync(reactDomLocal);
      const pairedReact = resolve(realReactDom, '..', 'react');
      if (existsSync(pairedReact)) return pairedReact;
    } catch {
      /* fall through to fallback */
    }
  }
  // 回退：web 自身 react 副本，或 workspace root 的 hoisted react
  const localReact = resolve(__dirname, 'node_modules/react');
  if (existsSync(localReact)) return localReact;
  return resolve(__dirname, '..', 'node_modules', 'react');
}

/** 解析 react-dom 路径（优先 web 自身副本，回退 root） */
function resolveReactDom(): string {
  const local = resolve(__dirname, 'node_modules/react-dom');
  if (existsSync(local)) return local;
  return resolve(__dirname, '..', 'node_modules', 'react-dom');
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // react 指向与 react-dom 配对的同一物理实例；react-dom 用 web 自身副本。
      // 二者由此共享同一 ReactSharedInternals，消除双实例。
      react: resolvePairedReact(),
      'react-dom': resolveReactDom(),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
