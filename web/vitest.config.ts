import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// 独立的 vitest 配置（不复用 vite.config.ts，避免 dev server proxy 干扰）。
// 定义与 vite.config.ts 一致的 __APP_VERSION__，让引用它的模块在测试中可加载。
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // pnpm hoisted node-linker 下 web/node_modules/react(物理 18.3.1) 与
      // .pnpm/react-dom@18.3.1_react@18.3.1 配对的 react(同 18.3.1) 是两份不同
      // 物理副本 → ReactSharedInternals 不一致 → useState 抛 "Cannot read null"。
      // 显式把 react / react-dom 及其子路径(react-dom/client 等)固定到 web 自身
      // 物理副本，保证组件与 react-dom 共享同一 react 实例。
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
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
