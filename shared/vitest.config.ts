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
  },
});
