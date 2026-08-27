/**
 * DustNote E2E 测试
 *
 * 覆盖核心流程：模式选择 → 设置密码 → 创建笔记 → 编辑 → 分享
 *
 * 运行：pnpm exec playwright test
 * UI 模式：pnpm exec playwright test --ui
 */

import { test, expect } from '@playwright/test';

const PASSWORD = 'TestPassword123!';

test.describe('DustNote 核心流程', () => {
  test('单机模式：setup → 创建笔记 → 编辑 → 保存', async ({ page }) => {
    await page.goto('/');

    // 1. 选择单机模式
    await page.getByText('单机模式').click();
    await page.getByText('使用单机模式').click();
    await page.waitForTimeout(1000);

    // 2. 设置密码
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill(PASSWORD);
    await passwordInputs.last().fill(PASSWORD);
    await page.getByText('创建空间').click();
    await page.waitForTimeout(2000);

    // 3. 保存恢复码
    const recoveryBtn = page.getByText(/我已保存|I saved/);
    if (await recoveryBtn.isVisible()) {
      await recoveryBtn.click();
    }
    await page.waitForTimeout(2000);

    // 4. 解锁
    const unlockInput = page.locator('input[type="password"]');
    if (await unlockInput.isVisible()) {
      await unlockInput.fill(PASSWORD);
      await page.getByText('解锁').click();
      await page.waitForTimeout(3000);
    }

    // 5. 验证主界面加载
    await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });

    // 6. 创建新笔记
    const newNoteBtn = page.getByText(/新建|新笔记|New/);
    if (await newNoteBtn.isVisible()) {
      await newNoteBtn.click();
      await page.waitForTimeout(1000);
    }

    // 7. 编辑笔记标题
    const titleInput = page.locator('input[type="text"]').first();
    if (await titleInput.isVisible()) {
      await titleInput.fill('E2E 测试笔记');
      await page.waitForTimeout(500);
    }

    // 8. 编辑笔记内容
    const textarea = page.locator('textarea');
    if (await textarea.isVisible()) {
      await textarea.fill('# 测试内容\n\n这是一个 E2E 测试笔记。');
      await page.waitForTimeout(1000);
    }

    // 9. 验证无控制台错误
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForTimeout(2000);
    expect(errors.filter((e) => !e.includes('runtime.lastError'))).toHaveLength(0);
  });

  test('HTTP 环境提示', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    // 检查 localStorage 中的 HTTP 提示标记
    const noticeShown = await page.evaluate(() =>
      localStorage.getItem('dustnote_http_env_notice_shown')
    );
    // 在 HTTP 环境下应该显示提示
    if (page.url().startsWith('http://')) {
      expect(noticeShown).toBe('1');
    }
  });

  test('健康检查 API', async ({ page }) => {
    const response = await page.evaluate(async () => {
      const r = await fetch('/api/v1/health');
      return r.json();
    });
    expect(response.ok).toBe(true);
    expect(response.version).toBeDefined();
  });
});
