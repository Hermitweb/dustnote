/**
 * UI 视觉基线 + 对比度门禁（docs/ui-optimization.md §4）
 *
 * 为什么先有这个再动样式：阶段 1.4 要删掉 `index.css` 里的 Tailwind 影子类，
 * 那是一次"改一处可能全站变色"的操作。没有可复跑的基线，就只能靠肉眼在评审里发现。
 *
 * 跑法：
 *   UI_BASELINE=1 pnpm exec playwright test e2e/visual-baseline.spec.ts --update-snapshots   # 首次建立基线
 *   UI_BASELINE=1 pnpm exec playwright test e2e/visual-baseline.spec.ts                       # 之后做回归比对
 * 报告产物：test-results/contrast-report.json（unresolved 数会随玻璃主题使用量上升，属预期）
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setupStandalone } from './helpers';
import { auditContrast, type ContrastReport } from './a11y-contrast';

const ENABLED = !!process.env.UI_BASELINE || !!process.env.CI;

/**
 * 已知豁免：selector 片段 → 原因。
 * 只允许"确实无法在 CSS 里修"的情况，新增豁免必须写理由。
 */
const ALLOWLIST: { includes: string; reason: string }[] = [];

test.describe('UI 基线', () => {
  test.skip(!ENABLED, '需要 UI_BASELINE=1（会拉起 dev server，单独 job 跑）');
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  const reports: ContrastReport[] = [];

  test.beforeEach(async ({ page }) => {
    await setupStandalone(page);
  });

  const audit = async (page: Page, name: string, testInfo?: TestInfo) => {
    const r = await auditContrast(page, name);
    reports.push(r);
    /**
     * 分级门禁：
     * - **纯色底不达标 = 失败**。这类没有借口，一定是代码写错（本次就抓到主按钮 3.68:1、
     *   强调色当文字 7 处）。
     * - **玻璃叠极光的最坏情况 = 记账不阻塞**。修法属于阶段 3 的"玻璃三档规矩"
     *   （docs/ui-optimization.md §2.2），在阶段 1 里把它变成红灯只会诱导出放宽阈值的坏做法；
     *   但数量必须打印出来并随版本下降，不允许悄悄归零口径。
     */
    const blocked = r.issues.filter(
      (i) => !i.overGradient && !ALLOWLIST.some((a) => i.selector.includes(a.includes))
    );
    const glass = r.issues.filter((i) => i.overGradient);
    testInfo?.annotations?.push?.({
      type: name,
      description: `纯色底失败 ${blocked.length} · 玻璃最坏情况 ${glass.length}`,
    });
    if (glass.length) {
      console.log(
        `[contrast:${name}] 玻璃最坏情况 ${glass.length} 处（阶段 3 处理）:\n` +
          glass
            .slice(0, 8)
            .map((i) => `  ${i.selector} "${i.text}" ${i.ratio}:1`)
            .join('\n')
      );
    }
    expect(
      blocked,
      `${name}：${blocked.length} 处文字在纯色底上未达 WCAG AA\n` +
        blocked
          .slice(0, 12)
          .map((i) => `  ${i.selector} "${i.text}" ${i.ratio}:1 (需 ${i.need})`)
          .join('\n')
    ).toHaveLength(0);
  };

  test('主页（浅色 · 默认主题）', async ({ page }, testInfo) => {
    // 全新空间会自动建并打开一篇欢迎笔记 → 先点导航轨的「概览」，把舞台收到落点态
    await page.getByRole('button', { name: /概览/ }).first().click();
    await expect(page.locator('#main-content').getByRole('heading', { level: 1 })).toBeVisible();
    await page.screenshot({ path: join('test-results', 'baseline-home.png') });
    await audit(page, 'home-light', testInfo);
  });

  /**
   * 舞台三态基线（UI 阶段 2.8：导航轨 + 舞台）
   *
   * 为什么不只靠单测：stage.ts 的纯函数在 jsdom 里已经测过「哪种事实落到哪一态」，
   * 这里要测的是接上真实组件之后 —— 目的地按钮、列表行、舞台头部、Esc、‹ › 翻篇
   * 是否真串得起来。截图同时充当两栏改造的视觉回归基线。
   * 用例不假设笔记条数：欢迎笔记的存在与否会改变结果集大小。
   */
  const stage = (page: Page) => page.locator('#main-content');
  const head = (page: Page) => page.getByRole('navigation', { name: '笔记位置' });

  const newNote = async (page: Page, title: string) => {
    await page
      .getByRole('button', { name: /新建笔记/ })
      .first()
      .click();
    // 标题框没有 type="text" 属性（外观全走 class），按无障碍名定位才稳
    const titleBox = page.getByRole('textbox', { name: /开始书写/ });
    await expect(titleBox).toBeVisible({ timeout: 10_000 });
    await titleBox.fill(title);
    await page.waitForTimeout(400); // 走真实防抖自动保存
  };

  test('舞台三态：概览 / 列表 / 详情 + Esc 与 ‹ › 翻篇', async ({ page }, testInfo) => {
    await newNote(page, '舞台甲');
    await newNote(page, '舞台乙');

    // —— 详情态：舞台头部补回「我在哪儿 / 还剩几篇 / 怎么回去」
    await expect(page.locator('textarea')).toBeVisible();
    await expect(head(page)).toBeVisible();
    await page.screenshot({ path: join('test-results', 'stage-detail.png') });
    await audit(page, 'stage-detail', testInfo);

    // —— 位置指示：欢迎笔记 + 刚建的两篇
    const rows = stage(page).getByRole('list').first().locator('> li');
    await page
      .getByRole('button', { name: /全部笔记/ })
      .first()
      .click();
    const total = await rows.count();
    expect(total).toBeGreaterThanOrEqual(3);
    await rows.first().locator('button').first().click();
    await expect(head(page).getByText(new RegExp('^1/' + total + '$'))).toBeVisible();

    // —— ‹ › 按钮与方向键都在结果集内翻篇，到边界停住
    await head(page).getByRole('button', { name: '下一篇' }).click();
    await expect(head(page).getByText(new RegExp('^2/' + total + '$'))).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(head(page).getByText(new RegExp('^3/' + total + '$'))).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(head(page).getByText(new RegExp('^' + total + '/' + total + '$'))).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(head(page).getByText(new RegExp('^' + total + '/' + total + '$'))).toBeVisible();

    // —— Esc 逐级回退：详情 → 目的地列表（两栏改造后列表就在舞台里）
    await page.keyboard.press('Escape');
    await expect(head(page)).toBeHidden();
    await expect(stage(page).getByRole('list').first()).toBeVisible();
    await page.screenshot({ path: join('test-results', 'stage-list.png') });
    await audit(page, 'stage-list', testInfo);

    // —— 概览态：统计 + 最近编辑 + 快捷入口
    await page.getByRole('button', { name: /概览/ }).first().click();
    await expect(stage(page).getByRole('heading', { level: 1 })).toBeVisible();
    await page.screenshot({ path: join('test-results', 'stage-overview.png') });
    await audit(page, 'stage-overview', testInfo);
  });

  const openSettings = async (page: Page) => {
    await page.getByRole('button', { name: '设置' }).first().click();
    // 主题区在"通用"标签里，等它出现再继续（比 waitForTimeout 稳）
    await expect(page.getByRole('button', { name: /浅色/ })).toBeVisible({ timeout: 10_000 });
  };

  test('图标轨（1024–1279 档收成 56px）', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1120, height: 780 });
    await page.waitForTimeout(400);
    const rail = page.locator('aside');
    await expect(rail).toBeVisible();
    /* 断点不是装饰：这一档下标签必须让位给图标，否则 56px 里会挤成一团 */
    await expect(rail.locator('.rail-label').first()).toBeHidden();
    await expect(rail.locator('.rail-mini-only').first()).toBeVisible();
    await page.screenshot({ path: join('test-results', 'rail-1120.png') });
    await audit(page, 'rail-1120', testInfo);
  });

  test('空搜索结果给出下一步（§2.4 四态之一）', async ({ page }, testInfo) => {
    await page.locator('input[type="search"]').fill('zzz不存在的词zzz');
    await page.waitForTimeout(500);
    const stage = page.locator('#main-content');
    await expect(stage.getByText('没有匹配', { exact: false }).first()).toBeVisible();
    /* 空态不是只有一句话：要能把人带回有路可走的地方 */
    await expect(stage.getByRole('button', { name: /清除搜索/ })).toBeVisible();
    await page.screenshot({ path: join('test-results', 'empty-search.png') });
    await audit(page, 'empty-search', testInfo);
  });

  test('设置弹窗：主题真实配色卡与材质档位', async ({ page }, testInfo) => {
    await openSettings(page);
    /* 改造前是 emoji 卡（🌿 🫧），传达不了两套蓝的差别；现在是明暗两排色带 */
    await expect(page.getByRole('button', { name: /尘心晨光/ })).toBeVisible();
    await expect(page.getByText('界面材质')).toBeVisible();
    await expect(page.getByRole('button', { name: '实色' })).toBeVisible();
    await page.screenshot({ path: join('test-results', 'settings-theme.png') });
    await audit(page, 'settings-theme', testInfo);
    /* 关掉玻璃：极光必须停（硬约束：文字不许直接压在渐变上） */
    await page.getByRole('button', { name: '实色' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-effect', 'flat');
    await page.waitForTimeout(400);
    await page.screenshot({ path: join('test-results', 'settings-flat.png') });
    await audit(page, 'settings-flat', testInfo);
  });
  test('设置弹窗（浅色）', async ({ page }, testInfo) => {
    await openSettings(page);
    await page.screenshot({ path: join('test-results', 'baseline-settings.png') });
    await audit(page, 'settings-light', testInfo);
  });

  test('深色模式主页 + 弹窗', async ({ page }, testInfo) => {
    await openSettings(page);
    // 按钮文案是「🌙 深色」（emoji 与文字同串），exact 匹配会落空
    await page.getByRole('button', { name: /深色/ }).first().click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark', { timeout: 10_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join('test-results', 'baseline-settings-dark.png') });
    await audit(page, 'settings-dark', testInfo);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await page.screenshot({ path: join('test-results', 'baseline-home-dark.png') });
    await audit(page, 'home-dark', testInfo);
  });

  test.afterEach(async ({}, testInfo) => {
    if (!reports.length) return;
    if (testInfo.phase !== 'finally') return;
  });

  test('写出对比度审计报告', async ({}, testInfo) => {
    testInfo.skip(reports.length === 0, '没有采集到数据');
    mkdirSync('test-results', { recursive: true });
    writeFileSync(
      join('test-results', 'contrast-report.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          checked: reports.reduce((n, r) => n + r.checked, 0),
          unresolvedOnGradient: reports.reduce((n, r) => n + r.overGradient, 0),
          issues: reports.reduce((n, r) => n + r.issues.filter((i) => !i.overGradient).length, 0),
          glassWorstCase: reports.reduce(
            (n, r) => n + r.issues.filter((i) => i.overGradient).length,
            0
          ),
          reports,
        },
        null,
        2
      )
    );
  });
});
