/**
 * mobile 单元测试基建（审计 TEST-004 补课，2026-09-25）
 *
 * 策略：**只 mock 平台 I/O 边界**（react-native / AsyncStorage / Keychain / i18n），
 * 其余全部真实运行——@dustnote/shared 的 ApiClient/deriveSecrets、zustand store、
 * 拦截器逻辑都跑真身；网络层通过桩 global.fetch 驱动（api.ts 的 ApiClient 每次
 * 请求新建并落到 defaultFetch=global fetch）。
 *
 * 用例聚焦 2026-09-24 真机审计真实暴露过的失败类别：
 * - auth 状态机（快速失败/慢速失败护栏/initFailed/lock/生物识别）
 * - diagnostics 队列（截断/去重/上限/禁用开关/批量回传/失败保留）
 * - api 401 静默刷新三态（ok/rejected/transient + 重放 + /auth/ 排除 + 单飞）
 * 不追求覆盖率——覆盖率对这类"状态机+边界"缺陷毫无保护力，用例列表才是承诺。
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const m = (p: string) => fileURLToPath(new URL(`./test/mocks/${p}`, import.meta.url));

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 20_000,
  },
  resolve: {
    alias: [
      // 裸包名（各模块直接 import 'react-native' 等）
      { find: /^react-native$/, replacement: m('react-native.ts') },
      { find: /^@react-native-async-storage\/async-storage$/, replacement: m('async-storage.ts') },
      { find: /^react-native-keychain$/, replacement: m('keychain.ts') },
      // i18n 相对导入的两种形态（auth.ts: '../lib/i18n'；error-text.ts: './i18n'）
      // ——i18next 真实初始化在测试里是噪音，桩成 t(key)=>key
      { find: /^\.\.\/lib\/i18n$/, replacement: m('i18n.ts') },
      { find: /^\.\/i18n$/, replacement: m('i18n.ts') },
    ],
  },
});
