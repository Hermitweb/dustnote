/**
 * E2E：图片止血的自动化证据（P0-3，2026-09-25 落地但此前只有纯函数单测）
 *
 * 为什么值得单独一条：图片本体存 IndexedDB、正文只留 `dustnote-img://` 引用，
 * 于是「联机模式下图片不跨设备」是用户能直接踩到的数据预期问题。当时的止血是
 * ①插入当场提示、②导出/备份还原成 data URL、④渲染出口把残引用换成占位图。
 * ①与②都触达 IndexedDB，属集成面，纯函数单测覆盖不到——这条用例就是那段证据。
 *
 * 口径说清楚：这里验的是 `storeImage` + `restoreNoteImages` 在真实浏览器里
 * 确实能把引用还原成 data URL，而导出路径（ImportExportDialog 的 .md/.html/.json）
 * 调的就是同一个 `restoreNoteImages`。所以「导出含图」这条结论是从共享机制推出来的，
 * 不是逐个下载文件验过的——想验到下载本身，得再加一条抓 download 事件的用例。
 */
import { test, expect, type Page } from '@playwright/test';
import { TEST_PASSWORD } from './helpers';

async function enterOnline(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForTimeout(2000);
  const pw = page.locator('input[type="password"]');
  if (
    await page
      .getByText('创建你的笔记空间')
      .isVisible()
      .catch(() => false)
  ) {
    await pw.first().fill(TEST_PASSWORD);
    await pw.last().fill(TEST_PASSWORD);
    await page
      .getByRole('button', { name: /创建|Create/ })
      .first()
      .click();
    await page.waitForTimeout(3000);
    const done = page.getByText(/我已保存|I saved/);
    await expect(done).toBeVisible({ timeout: 15_000 });
    await done.click();
    await page.waitForTimeout(2000);
  }
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
  await expect(page.getByRole('button', { name: /新建笔记|新笔记/ }).first()).toBeVisible({
    timeout: 15_000,
  });
}

/** 1x1 PNG，够触发压缩与入库路径，又不必往仓库塞二进制夹具 */
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 把一张 PNG 当成剪贴板图片粘进编辑器（走 onPaste → handleImages 的真实链路） */
async function pastePng(page: Page): Promise<void> {
  const ok = await page.evaluate(async (b64) => {
    const ta = document.querySelector('textarea');
    if (!(ta instanceof HTMLTextAreaElement)) return false;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], 'shot.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    ta.focus();
    // Chromium 支持用 clipboardData 构造 ClipboardEvent；React 的合成事件挂在根节点，
    // 所以必须 bubbles: true，否则 onPaste 收不到。
    ta.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    );
    return true;
  }, PNG_1PX);
  expect(ok, '没找到 textarea，粘贴无从触发').toBe(true);
}

test.describe('图片止血', () => {
  test('联机模式插入图片：当场说明不跨设备，且引用能还原成 data URL', async ({ page }) => {
    test.info().annotations.push({
      type: 'scope',
      description: '联机模式（真实后端）——单机模式不出现该提示，是设计而非漏网',
    });
    await enterOnline(page);
    await page
      .getByRole('button', { name: /新建笔记|新笔记/ })
      .first()
      .click();
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10_000 });

    await pastePng(page);

    // ① 止血当场提示：正文里出现本地引用，且提示语说清「不会同步到其他设备」
    const ta = page.locator('textarea').first();
    await expect(ta).toContainText('dustnote-img://', { timeout: 15_000 });
    await expect(page.getByText(/不会同步到其他设备|will NOT sync to other devices/)).toBeVisible({
      timeout: 10_000,
    });

    // ② 引用能还原成 data URL：切到预览，IndexedDB 里的本体必须真的读回来。
    //    这一步同时是「导出含图」的机制证据——导出调的是同一个 restoreNoteImages。
    await page
      .getByRole('button', { name: /预览|Preview/ })
      .first()
      .click();
    const img = page.locator('img[src^="data:"]').first();
    await expect(img).toBeVisible({ timeout: 15_000 });
    const src = await img.getAttribute('src');
    expect(src ?? '', '还原后的 src 应是带 MIME 的 data URL（P0-3 顺带修的 MIME 问题）').toMatch(
      /^data:image\/(png|jpeg|webp);base64,/
    );
  });

  test('引用还原不了时渲染占位图，而不是空白或裸协议串', async ({ page }) => {
    // 对端设备 / 换浏览器 profile 的情形：正文里有引用，但本体不在本机 IndexedDB。
    // 那时渲染出口必须换成占位，否则用户看到的是「图不见了」而没有任何解释。
    await enterOnline(page);
    await page
      .getByRole('button', { name: /新建笔记|新笔记/ })
      .first()
      .click();
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10_000 });
    const ghost = '![缺图](dustnote-img://' + 'deadbeef01' + ')';
    await page.locator('textarea').first().fill(ghost);
    await page
      .getByRole('button', { name: /预览|Preview/ })
      .first()
      .click();
    // 默认就是分屏，页面上本来就有别的图标类 img，所以定位必须按 src 前缀收窄，
    // 不能拿 first() 的任意 img 当占位图——那会验到无关元素上（第一版就是这么误报的）。
    const placeholder = page.locator('img[src^="data:image/svg"]').first();
    await expect(placeholder).toBeVisible({ timeout: 15_000 });
    const src = (await placeholder.getAttribute('src')) ?? '';
    expect(src.length, '占位图应是 data URL').toBeGreaterThan(0);
    expect(src).not.toContain('dustnote-img');
    // 裸协议串不许漏到界面上：预览区里出现 dustnote-img:// 文本就是止血失效
    const leaked = await page.evaluate(() =>
      Array.from(document.querySelectorAll('div,span,p,section,code')).some(
        (n) => n.children.length === 0 && (n.textContent || '').includes('dustnote-img://')
      )
    );
    expect(leaked, '预览里不许出现裸的 dustnote-img:// 文本').toBe(false);
  });
});
