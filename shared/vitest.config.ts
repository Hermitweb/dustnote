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
    // 审计 TEST-003/R03：阈值 = 实测基准留 ~3% 余量（2026-09-21 实测
    // lines/stmts 78.66%、funcs 86.58%、branches 76.83%），防倒退且避免贴边翻红。
    // 阈值仅对 --coverage 生效（vitest 行为），普通 pnpm test 不受影响。
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: {
        lines: 75,
        functions: 83,
        branches: 73,
        statements: 75,
      },
    },
  },
});
