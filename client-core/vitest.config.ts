import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 审计 TEST-003：覆盖率阈值 = 当前实测基准（84.1%）+1，防倒退
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: {
        lines: 84,
        functions: 75,
        branches: 89,
        statements: 84,
      },
    },
  },
});
