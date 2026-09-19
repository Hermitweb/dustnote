import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 审计 TEST-003：server 当前整体覆盖率低（路由层大量依赖集成测试），
    // 首期只对「已测模块」设下限防倒退；阈值随测试补齐逐步上调。
    // exclude 测试文件自身与脚本目录。
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/scripts/**'],
      thresholds: {
        lines: 34,
        functions: 55,
        branches: 70,
        statements: 34,
      },
    },
  },
});
