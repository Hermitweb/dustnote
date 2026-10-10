import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 审计 TEST-003：server 当前整体覆盖率低（路由层大量依赖集成测试），
    // 首期只对「已测模块」设下限防倒退；阈值随测试补齐逐步上调。
    // exclude 测试文件自身与脚本目录。
    // 2026-10-11 S-M1 批次后实测：lines/stmts 39.51% / funcs 65.11% /
    // branches 72.55%（新增 app.test 限流分桶 2 条）。阈值按实测留 ~4% 余量
    // 设定，防门禁抖动；随测试补齐逐步上调（routes 24% 是主要缺口）。
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/scripts/**'],
      thresholds: {
        lines: 36,
        functions: 60,
        branches: 68,
        statements: 36,
      },
    },
  },
});
