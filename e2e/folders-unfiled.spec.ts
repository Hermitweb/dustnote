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
    await page
      .getByRole('button', { name: /^删除$/ })
      .last()
      .click();
    await page.waitForTimeout(1500);

    // M1 回归：0 文件夹时「未分类」节点必须渲染（此前 unfiledCount===0 时不渲染）
    await expect(page.getByText('未分类').first()).toBeVisible({ timeout: 5000 });

    // H-A 回归：此时顶栏新建应可用（落未分类），不再只弹「请先选择文件夹」
    await page.getByRole('button', { name: /新建/ }).first().click();
    await page.waitForTimeout(2000);
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('顶栏常驻作用域标题', () => {
  /*
   * 图标轨档（1024–1279）把侧栏收成 56px，条目只剩图标；浮层解决"我指着哪个"，
   * 但"我现在在哪"必须不靠 hover、不靠点也能读到 —— 这一行就是为那个场景存在的。
   * 断言用真浏览器点出来的结果，不是组件单测能覆盖的（要跨 store 与 i18n）。
   */
  test('点文件夹与四个目的地，顶栏标题一路跟着换', async ({ page }) => {
    await setupStandalone(page);

    const title = page.locator('[data-scope-title]');
    await expect(title).toBeVisible({ timeout: 10_000 });
    // 默认文件夹由 ensureDefaultContent 建出来，名字固定
    const folder = page.getByText('关于尘渊笔记').first();
    await expect(folder).toBeVisible({ timeout: 10_000 });

    await folder.click();
    await expect(title).toHaveText('关于尘渊笔记', { timeout: 5_000 });

    // 「未分类」只在有未分类笔记、或一个文件夹都没有时才渲染（H8/M1 的条件），
    // 这里的场景两者都不满足，所以走四个常驻目的地：它们才是图标轨档下
    // 唯一"点亮着但读不出名字"的那批条目。
    await page.getByRole('button', { name: '概览' }).first().click();
    await expect(title).toHaveText('概览', { timeout: 5_000 });

    await page.getByRole('button', { name: '回收站' }).first().click();
    await expect(title).toHaveText('回收站', { timeout: 5_000 });

    await page.getByRole('button', { name: '全部笔记' }).first().click();
    await expect(title).toHaveText('全部笔记', { timeout: 5_000 });
  });
});

test.describe('登出（技术债）', () => {
  test('退出登录后回到解锁页并清掉本机 refresh token', async ({ page }) => {
    await setupStandalone(page);

    // 打开设置
    await page
      .getByRole('button', { name: /设置|Settings/ })
      .first()
      .click();
    await page.waitForTimeout(800);

    // 会话 → 退出登录
    const logoutBtn = page.getByRole('button', { name: /退出登录|Sign out/ }).first();
    await expect(logoutBtn).toBeVisible({ timeout: 5000 });
    await logoutBtn.click();

    await expect(page.getByText(/确定退出登录/)).toBeVisible({ timeout: 5000 });
    await page
      .getByRole('button', { name: /退出登录|Sign out/ })
      .last()
      .click();
    await page.waitForTimeout(1500);

    // 回到解锁页
    await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 10_000 });
    // 本机 refresh token 已清除
    const rt = await page.evaluate(() => localStorage.getItem('dustnote_refresh'));
    expect(rt).toBeNull();
  });
});
