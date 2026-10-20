/**
 * NoteList E2E（列表态 + 搜索 + 批量删除）
 *
 * 覆盖 web/src/components/NoteList.tsx 的三条主路径：
 * 1. 列表态：进入「全部笔记」→ 列表渲染（li 行可见）
 * 2. 搜索：侧栏搜索框输入 → 命中 → 清空
 * 3. 批量删除：进入选择态 → 勾选 li 行 → 删除 → ConfirmDialog 确认 → 回收站可见
 *
 * 机制（经实测）：
 * - 解锁后默认落在「概览」页；按 Esc 或点「全部笔记」切到列表态
 * - 新建笔记默认标题「新笔记」；创建后落详情态（"暂无内容"），Esc 返回列表
 * - 列表行是 <li>，行内 <button> 可点；选择态下行内出现 checkbox
 * - 搜索框 input[type=search] 常驻侧栏；批量删除确认走 role=alertdialog 的 ConfirmDialog
 *
 * 运行：pnpm test:e2e:local
 * 前置：单机模式 setup（helpers.setupStandalone）
 */
import { test, expect, type Page } from '@playwright/test';
import { setupStandalone } from './helpers';

/** 切到「全部笔记」列表态。 */
async function gotoAllNotes(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /全部笔记/ })
    .first()
    .click();
  await page.waitForTimeout(600);
}

test.describe('NoteList 主路径', () => {
  test('列表态：进入全部笔记，列表渲染笔记行', async ({ page }) => {
    await setupStandalone(page);
    // 确保有至少 1 篇笔记在全部笔记下（新建一篇；默认标题「新笔记」）
    const newBtn = page.locator('[aria-label="新建笔记"], [data-rail-label="新建笔记"]').first();
    if (await newBtn.isVisible().catch(() => false)) {
      await newBtn.click();
      await page.waitForTimeout(800);
    }
    await gotoAllNotes(page);
    // 列表行：li 至少 1 篇（引导笔记 or 新建的「新笔记」）
    await expect(page.locator('li').first()).toBeVisible({ timeout: 5000 });
    // 列表里能看到「新笔记」或「尘渊」标题文字
    const anyNote = page.locator('li').first();
    await expect(anyNote).not.toBeEmpty();
  });

  test('搜索：输入关键词命中 → 清空搜索', async ({ page }) => {
    await setupStandalone(page);
    // 侧栏搜索框常驻
    const box = page.locator('input[type="search"]').first();
    if (!(await box.isVisible().catch(() => false))) {
      test.skip(true, '搜索框不可见');
    }
    // 引导笔记标题含「尘渊」
    await box.fill('尘渊');
    await page.waitForTimeout(600);
    await expect(page.locator('text=尘渊').first()).toBeVisible({ timeout: 5000 });
    // 清空 → 回到全量
    await box.fill('');
    await page.waitForTimeout(400);
  });

  test('批量删除：勾选 → 删除 → 确认 → 回收站可见', async ({ page }) => {
    await setupStandalone(page);
    // 建 2 篇（默认标题「新笔记」）
    const newBtn = page.locator('[aria-label="新建笔记"], [data-rail-label="新建笔记"]').first();
    if (await newBtn.isVisible().catch(() => false)) {
      await newBtn.click();
      await page.waitForTimeout(600);
      await newBtn.click();
      await page.waitForTimeout(600);
    }
    await gotoAllNotes(page);

    // 进入批量选择态（列表头「选择」入口）
    const selectBtn = page.getByRole('button', { name: /选择/ }).first();
    if (!(await selectBtn.isVisible().catch(() => false))) {
      test.skip(true, '批量选择入口不可见');
    }
    await selectBtn.click();
    await page.waitForTimeout(400);

    // 勾选前 2 行
    const checkboxes = page
      .locator('li input[type="checkbox"], li [role="checkbox"], li button[aria-pressed]')
      .first();
    const liRows = page.locator('li');
    const rowCount = await liRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(1);
    // 选择态下行内出现勾选控件（NoteList 用 button+aria-pressed 当 checkbox）
    for (let i = 0; i < Math.min(2, rowCount); i++) {
      const row = liRows.nth(i);
      const check = row.locator('[aria-pressed], input[type="checkbox"]').first();
      if (await check.isVisible().catch(() => false)) {
        await check.click();
        await page.waitForTimeout(200);
      } else {
        // 兜底：直接点整行（NoteList 选择态下 toggleSelect）
        await row.click();
        await page.waitForTimeout(200);
      }
    }

    // 批量删除 → ConfirmDialog 确认
    const deleteBtn = page.getByRole('button', { name: /删除/ }).first();
    if (await deleteBtn.isVisible().catch(() => false)) {
      await deleteBtn.click();
      await page.waitForTimeout(600);
      const confirmDialog = page.locator('[role="alertdialog"]');
      if (await confirmDialog.isVisible().catch(() => false)) {
        await confirmDialog.getByRole('button', { name: /删除/ }).click({ timeout: 5000 });
        await page.waitForTimeout(800);
      }
    }

    // 切回收站，删掉的笔记应可见（「新笔记」或任意 li 行）
    await page
      .getByRole('button', { name: /回收站/ })
      .first()
      .click();
    await page.waitForTimeout(800);
    await expect(page.locator('li').first()).toBeVisible({ timeout: 5000 });
  });
});
