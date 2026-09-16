/**
 * E2E：文件夹删除 → 未分类可达（H8/M1/H-A 回归）+ 登出清理（技术债）
 *
 * - 删光文件夹后「未分类」节点必须可见,且顶栏新建不再死端（M1/H-A）
 * - 主动登出必须清掉本机 refresh token 并回到解锁页（技术债新增能力）
 *
 * 运行：pnpm exec playwright test（CI）或
 *      npx playwright test --config=playwright.local.config.ts（本机用系统 Chrome）
 */

import { test, expect } from '@playwright/test';
import { setupStandalone } from './helpers';

test.describe('文件夹与未分类', () => {
  test('删光文件夹后：未分类节点可见，顶栏新建不再死端', async ({ page }) => {
    await setupStandalone(page);

    // 默认文件夹「关于尘渊笔记」由 ensureDefaultContent 创建
    const defaultFolder = page.getByText('关于尘渊笔记').first();
    await expect(defaultFolder).toBeVisible({ timeout: 10_000 });

    // 右键删除该文件夹 → 出现确认弹窗（H8：此前无确认）
    await defaultFolder.click({ button: 'right' });
    await page.getByText('删除', { exact: true }).first().click();
    await expect(page.getByText(/确定删除文件夹/)).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /^删除$/ }).last().click();
    await page.waitForTimeout(1500);

    // M1 回归：0 文件夹时「未分类」节点必须渲染（此前 unfiledCount===0 时不渲染）
    await expect(page.getByText('未分类').first()).toBeVisible({ timeout: 5000 });

    // H-A 回归：此时顶栏新建应可用（落未分类），不再只弹「请先选择文件夹」
    await page.getByRole('button', { name: /新建/ }).first().click();
    await page.waitForTimeout(2000);
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('登出（技术债）', () => {
  test('退出登录后回到解锁页并清掉本机 refresh token', async ({ page }) => {
    await setupStandalone(page);

    // 打开设置
    await page.getByRole('button', { name: /设置|Settings/ }).first().click();
    await page.waitForTimeout(800);

    // 会话 → 退出登录
    const logoutBtn = page.getByRole('button', { name: /退出登录|Sign out/ }).first();
    await expect(logoutBtn).toBeVisible({ timeout: 5000 });
    await logoutBtn.click();

    await expect(page.getByText(/确定退出登录/)).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /退出登录|Sign out/ }).last().click();
    await page.waitForTimeout(1500);

    // 回到解锁页
    await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 10_000 });
    // 本机 refresh token 已清除
    const rt = await page.evaluate(() => localStorage.getItem('dustnote_refresh'));
    expect(rt).toBeNull();
  });
});
