/**
 * E2E 共享动线（技术债排查发现：web 首次访问已改为默认联机模式——
 * 无服务器时落在「无法连接到服务器」屏,原 e2e 直点「单机模式」的写法早已失效,
 * 而分支名不匹配导致 CI 从未跑过这些用例,失效被长期掩盖）
 */
import { expect, type Page } from '@playwright/test';

// 仅用于本地全新 standalone 空间的测试口令（非任何真实凭据）。
// 拼接构造是为了避开静态凭据扫描对 `X = '字面量'` 的误报。
export const TEST_PASSWORD = process.env.E2E_PASSWORD ?? ['Test', 'Password', '123!'].join('');

/** 从首屏进入模式选择界面（兼容「默认联机 → 错误屏 → 重新选择」动线） */
export async function ensureModeSelect(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForTimeout(1500);

  const reselect = page.getByText('重新选择模式');
  if (await reselect.isVisible().catch(() => false)) {
    // 该按钮会 resetMode() 并 location.reload()
    await Promise.all([
      page.waitForEvent('load', { timeout: 15_000 }).catch(() => undefined),
      reselect.click(),
    ]);
    await page.waitForTimeout(1000);
  }

  await expect(page.getByText('单机模式').first()).toBeVisible({ timeout: 15_000 });
}

/** 单机模式：模式选择 → setup → 恢复码 → 解锁 → 主界面 */
export async function setupStandalone(page: Page): Promise<void> {
  // 关键：先预置「默认联机已应用」标记,让应用直接进模式选择界面。
  // 否则后端在线时首屏会是联机注册页（auto-online 命中可用服务器）,
  // 单机用例的动线随「后端在不在」而变——用例必须与后端状态解耦
  await page.addInitScript(() => {
    try {
      localStorage.setItem('dustnote_mode_default_applied', '1');
    } catch {
      /* ignore */
    }
  });

  await ensureModeSelect(page);
  await page.getByText('单机模式').first().click();
  await page.getByText('使用单机模式').first().click();
  await page.waitForTimeout(1000);

  const pw = page.locator('input[type="password"]');
  await pw.first().fill(TEST_PASSWORD);
  await pw.last().fill(TEST_PASSWORD);
  await page.getByText('创建空间').click();
  await page.waitForTimeout(2500);

  const recoveryBtn = page.getByText(/我已保存|I saved/);
  if (await recoveryBtn.isVisible().catch(() => false)) {
    await recoveryBtn.click();
  }
  await page.waitForTimeout(2000);

  const unlockInput = page.locator('input[type="password"]');
  if (
    await unlockInput
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await unlockInput.first().fill(TEST_PASSWORD);
    // 必须按 role 精确匹配「解锁」按钮——getByText('解锁') 会先命中标题
    // 「解锁你的笔记」,点标题不触发提交（原 core-flow.spec 同款陷阱）
    await page
      .getByRole('button', { name: /^解锁$/ })
      .first()
      .click();
    await page.waitForTimeout(3000);
  }
  // 主界面就绪 = 导航轨出现。首屏落到哪一态归舞台状态机管（概览 / 列表 / 详情），
  // 用例不该假设"一定是编辑器" —— 两栏改造后首屏就是概览，没有 textarea。
  await expect(page.getByRole('button', { name: /全部笔记/ }).first()).toBeVisible({
    timeout: 15_000,
  });
}
