import { defineConfig } from 'vitest/config';

/**
 * Vitest 配置
 *
 * testTimeout 调高到 60s：Argon2id（m=64MB, t=3, p=4）单次约 1-2s，
 * local-auth 的 setup/unlock/recover 流程涉及多次 KDF，需更长超时。
 */
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // 审计 TEST-003：覆盖率阈值 = 当前实测基准，防倒退。
    // 阈值仅对 --coverage 生效（vitest 行为），普通 pnpm test 不受影响。
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: {
        lines: 78,
        functions: 85,
        branches: 75,
        statements: 78,
      },
    },
  },
});
