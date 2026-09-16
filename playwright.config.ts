import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    // 后端（联机流程用例需要真实 API；健康检查用例也据此从 skip 变 pass）
    // 用独立临时库,避免污染开发库。注意 env 必须**合并 process.env**——
    // Playwright 的 env 是整体替换,直接传对象会丢 PATH 导致 pnpm 起不来。
    // 也不用 tsx watch（e2e 不需要热重载,且 watch 在无 TTY 下行为不稳）
    {
      command: 'pnpm --filter @dustnote/server exec tsx src/index.ts',
      url: 'http://localhost:3210/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PORT: '3210',
        DB_PATH: './data/e2e.db',
        JWT_SECRET: 'e2e-only-test-secret-not-used-anywhere-else-0123456789',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: 'pnpm --filter @dustnote/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
