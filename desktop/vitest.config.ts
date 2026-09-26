/**
 * desktop 单元测试基建（审计 TEST-004 补课，2026-09-26）
 *
 * 策略与 mobile 一致：**只 mock 平台 I/O 边界**（Tauri IPC / 事件 / autostart /
 * notification / web i18n），业务判断跑真身 —— 因为桌面端真正会出事的正是
 * "更新链路把任意 URL 当可信来源"、"IPC 挂起把界面钉死"这类边界判断。
 *
 * 不追覆盖率：覆盖率对"有没有把待校验 URL 的 origin 加进白名单"这种缺陷毫无保护力，
 * 用例列表才是承诺。
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const m = (p: string) => fileURLToPath(new URL(`./test/mocks/${p}`, import.meta.url));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('9.9.9'),
  },
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@tauri-apps\/api\/core$/, replacement: m('tauri-core.ts') },
      { find: /^@tauri-apps\/api\/event$/, replacement: m('tauri-event.ts') },
      { find: /^@tauri-apps\/plugin-autostart$/, replacement: m('tauri-autostart.ts') },
      { find: /^@tauri-apps\/plugin-notification$/, replacement: m('tauri-notification.ts') },
      { find: /^@dustnote\/web\/i18n$/, replacement: m('web-i18n.ts') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 20_000,
  },
});
