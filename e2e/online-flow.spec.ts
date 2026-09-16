/**
 * E2E：联机模式全链路（真实后端）
 *
 * 审计遗留项「e2e 只覆盖单机冒烟、联机流程零覆盖」的补齐：
 * 服务端注册（auth/setup）→ 恢复码 → 解锁 → 主界面 → 新建笔记 → 打开编辑器。
 * 后端由 playwright.config.ts 的 webServer 数组拉起（独立临时库 data/e2e.db）。
 *
 * 运行：pnpm exec playwright test（CI）或
 *      npx playwright test --config=playwright.local.config.ts（本机系统 Chrome）
 */

import { test, expect } from '@playwright/test';
import { TEST_PASSWORD } from './helpers';

test.describe('联机模式', () => {
  test('注册 → 解锁 → 新建笔记（真实 API）', async ({ page }) => {
    await page.goto('/');
    // web 首访自动进联机模式（同源）；后端已初始化过时直接落在解锁页
    await page.waitForTimeout(2000);

    const pw = page.locator('input[type="password"]');

    // 注册分支：全新库时显示「创建你的笔记空间」
    const setupTitle = page.getByText('创建你的笔记空间');
    if (await setupTitle.isVisible().catch(() => false)) {
      await pw.first().fill(TEST_PASSWORD);
      await pw.last().fill(TEST_PASSWORD);
      await page
        .getByRole('button', { name: /创建|Create/ })
        .first()
        .click();
      await page.waitForTimeout(3000);
      // 恢复码页
      const done = page.getByText(/我已保存|I saved/);
      await expect(done).toBeVisible({ timeout: 15_000 });
      await done.click();
      await page.waitForTimeout(2000);
    }

    // 解锁分支（注册后仍需输密码解锁）
    if (
      await pw
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await pw.first().fill(TEST_PASSWORD);
      await page
        .getByRole('button', { name: /^解锁$/ })
        .first()
        .click();
      await page.waitForTimeout(3000);
    }

    // 主界面就绪：以侧边栏「新建笔记」为准。
    // 不能用 textarea —— 解锁后应用**不会**自动选中笔记（编辑区显示
    // 「选择左侧笔记开始阅读」），断言 textarea 只在「刚注册完」这条路径上成立，
    // 第二次跑（库已有用户 → 走解锁分支）必挂。
    await expect(page.getByRole('button', { name: /新建笔记|新笔记/ }).first()).toBeVisible({
      timeout: 15_000,
    });

    // 显式选中种子文件夹：产品约束是「笔记必须归属文件夹」，未选中文件夹时
    // 主 CTA 只弹「请先选择文件夹」而不创建。注册后应用会自动选中种子文件夹，
    // 重新解锁则不会 —— 不显式选就会走进提示分支，本用例与库状态绑定。
    const seedFolder = page.getByRole('button', { name: /关于尘渊笔记/ }).first();
    if (await seedFolder.isVisible().catch(() => false)) {
      await seedFolder.click();
      await page.waitForTimeout(1200);
    }

    // 新建笔记（联机模式走 POST /notes + 乐观锁，回归 batch 修复的 version 兜底）
    await page
      .getByRole('button', { name: /新建笔记|新笔记/ })
      .first()
      .click();
    await page.waitForTimeout(2500);
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10_000 });
  });
});
