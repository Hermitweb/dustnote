import { test, expect, type Page } from '@playwright/test';
import { setupStandalone } from './helpers';

/**
 * 密度切换要「字号 + 行高 + 间距」三者同时变
 * （docs/ui-optimization.md §4 度量表里那一行「切换舒适/标准/紧凑后的可测差异」）
 *
 * 为什么必须放在真浏览器里测：jsdom 不做 CSS 层叠，`text-sm` 到底有没有读到
 * `--mn-text-sm` 在单测里永远看不出来——而这正是缺陷能存活的原因：令牌定义了、
 * applyTypography 也写了变量、单测也过了，可类名压根不读，于是设置里只有行高在动。
 * 这里量的是**计算后的样式**，骗不了人。
 */
test.describe('密度三通道', () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    // setupStandalone 落在书写态：这一屏同时有标题字号、书写面行高与 p-N 间距，
    // 三个通道不用跨页就能量到（概览页没有书写面）。
    await setupStandalone(page);
    await expect(page.locator('.editor-textarea, .prose').first()).toBeVisible();
  });

  /** 三个通道 + 旋钮本身的计算值 */
  const measure = (page: Page) =>
    page.evaluate(() => {
      const root = document.documentElement;
      const px = (v: string) => Math.round(parseFloat(v) * 100) / 100;
      // 标题输入用了 text-2xl：它证明字号这一路真的吃到了 --mn-density
      const title = document.querySelector<HTMLElement>('[class*="text-2xl"]');
      const writing =
        document.querySelector<HTMLElement>('.editor-textarea') ||
        document.querySelector<HTMLElement>('.prose');
      // 找一个用了间距阶梯的元素；按类名模式找，标记挪位也不会让探针失效
      const padded = Array.from(document.querySelectorAll<HTMLElement>('*')).find((el) =>
        /\bp-[234]\b/.test(typeof el.className === 'string' ? el.className : '')
      );
      return {
        density: parseFloat(getComputedStyle(root).getPropertyValue('--mn-density')) || 1,
        titleFont: title ? px(getComputedStyle(title).fontSize) : null,
        writingLine: writing ? px(getComputedStyle(writing).lineHeight) : null,
        paddedPx: padded ? px(getComputedStyle(padded).paddingTop) : null,
      };
    });

  const setDensity = async (page: Page, label: RegExp) => {
    await page.getByRole('button', { name: '设置' }).first().click();
    await page.getByRole('button', { name: label }).first().click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  };

  test('舒适 / 标准 / 紧凑：三个通道同时动，且比例对得上', async ({ page }) => {
    await setDensity(page, /^标准$/);
    const std = await measure(page);
    await setDensity(page, /^舒适$/);
    const soft = await measure(page);
    await setDensity(page, /^紧凑$/);
    const tight = await measure(page);

    console.log('[density] 标准 ' + JSON.stringify(std));
    console.log('[density] 舒适 ' + JSON.stringify(soft));
    console.log('[density] 紧凑 ' + JSON.stringify(tight));

    // 旋钮本身要真的写进 :root
    expect(std.density).toBeCloseTo(1, 2);
    expect(soft.density).toBeGreaterThan(1.05);
    expect(tight.density).toBeLessThan(0.95);

    const channels: Array<[string, number | null, number | null, number | null]> = [
      ['字号', std.titleFont, soft.titleFont, tight.titleFont],
      ['行高', std.writingLine, soft.writingLine, tight.writingLine],
      ['间距', std.paddedPx, soft.paddedPx, tight.paddedPx],
    ];
    for (const [name, a, b, c] of channels) {
      expect(a, name + '：标准档基线没取到，探针失效了').not.toBeNull();
      expect(b! / a!, name + '：舒适档应当更大').toBeGreaterThan(1.03);
      expect(c! / a!, name + '：紧凑档应当更小').toBeLessThan(0.97);
    }

    // 字号与间距必须跟着同一个乘数，否则「密度」其实是三个各调各的开关
    expect(soft.titleFont! / std.titleFont!).toBeCloseTo(soft.paddedPx! / std.paddedPx!, 2);
    expect(tight.titleFont! / std.titleFont!).toBeCloseTo(tight.paddedPx! / std.paddedPx!, 2);
  });

  test('键盘聚焦时焦点环真的可见（组件不许再把它抹掉）', async ({ page }) => {
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        width: cs.outlineWidth,
        style: cs.outlineStyle,
        shadow: cs.boxShadow,
      };
    });
    console.log('[focus] ' + JSON.stringify(ring));
    expect(ring, 'Tab 之后应当聚焦到某个元素').not.toBeNull();
    expect(ring!.style, 'outline 不能是 none：那意味着键盘用户看不到焦点').not.toBe('none');
    expect(parseFloat(ring!.width)).toBeGreaterThanOrEqual(2);
    // 双层描边的第二层：一圈 --mn-bg 光晕（自带 shadow-* 的元素曾把它顶掉，已修）
    expect(ring!.shadow, '光晕应当存在且不组件的 shadow-* 顶掉').toMatch(/rgb/);
  });
});
