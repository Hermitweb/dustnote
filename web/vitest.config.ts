import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// 独立的 vitest 配置（不复用 vite.config.ts，避免 dev server proxy 干扰）。
// 定义与 vite.config.ts 一致的 __APP_VERSION__，让引用它的模块在测试中可加载。
//
// react 单实例说明：
// 本仓库 .npmrc 使用 node-linker=hoisted（RN 兼容）。历史上 web 用
// react@18.3.1 而 mobile/RN 钉死 react@18.2.0，hoist 后根目录 react@18.2.0
// 与 web/node_modules/react@18.3.1 共存；vitest externalize react-dom 时其
// 内部 require('react') 走 Node 原生解析命中根 18.2.0，与组件实例分裂 →
// "Cannot read properties of null (reading 'useState')"。
// 已将 web 的 react / react-dom 钉到 18.2.0（与 RN 同版本，18.3 相对 18.2
// 仅多 React 19 弃用警告，无功能差异），全仓只剩一份物理 react，
// 任何解析路径都命中同一实例，无需 alias / inline 等兜底。

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test-setup.ts', 'src/main.tsx', 'src/**/*.d.ts'],
      // 审计 TEST-R01：阈值按 web 实测覆盖率(2026-09-21: lines/stmts 23.97%,
      // funcs 45.77%, branches 80.23%)留 ~4% 余量设定，避免门禁直接红灯；
      // 随测试补充逐步上调（web 组件/页面测试仍偏少，是主要缺口）。
      thresholds: {
        lines: 20,
        statements: 20,
        functions: 40,
        branches: 75,
      },
    },
  },
});
