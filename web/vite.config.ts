import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3210',
        changeOrigin: true,
        // ws: true 不能省。生产环境 nginx 会带 Upgrade 头转发 /api/，
        // 而 vite 默认**不代理 WebSocket 升级**——于是开发/e2e 里
        // /api/v1/sync/ws 这条实时同步链路根本连不上，且客户端只会静默退避重连，
        // 看起来像「同步不灵」而不是「环境缺了传输」。2026-10-01 补实时同步 e2e 时撞出来的。
        ws: true,
      },
    },
  },
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
  build: {
    outDir: 'dist',
    // 审计 TEST-005：生产默认不产出 sourcemap，避免 .map 随 web-dist 制品公开
    // 导致源码可被还原。若需 Sentry 可读堆栈：在 CI 专用步骤临时生成并上传后，
    // 从制品中删除 *.map 再打包，勿让 .map 进入对外可下载的静态目录。
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          shared: ['@dustnote/shared'],
        },
      },
    },
  },
});
