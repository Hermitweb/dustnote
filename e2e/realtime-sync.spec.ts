/**
 * E2E：WebSocket 实时同步（产品头牌承诺的唯一自动化证据）
 *
 * 为什么必须有：README 与官网都写着「1 秒内同步到所有在线设备」，而这条链路此前
 * **没有任何自动化覆盖**——全仓 49 个测试文件里只有 1 处顺带提到 ws。客户端侧也没有
 * 轮询兜底（web/src/lib/sync-ws.ts 里 setInterval 0 处、无 visibilitychange/focus 重拉），
 * 所以「另一端看到」这件事只能由 WS 兑现；WS 静默断掉而退避到 60s 封顶时，
 * 用户视角就是「同步不灵」，而当时没有任何一条测试会红。
 *
 * 写这条用例的当场就抓到一个真问题：web/vite.config.ts 的 /api 代理没开 ws: true，
 * 于是**开发与 e2e 环境里实时同步链路根本连不上**（生产由 nginx 带 Upgrade 头转发，
 * 所以线上是好的）。表现是 B 端永远收不到广播，而客户端只会静默重连，
 * 看起来像功能坏了而不是环境缺了传输。已修，见 vite.config.ts 的注释。
 *
 * 断言口径（诚实边界）：产品宣称 < 1s，这里放宽到 ≤ 5s。本机实测端到端 0.9–2.0s
 * （其中 1.5s 是自动保存防抖、0.3s 是广播防抖，WS 那一跳本身远小于一秒）。
 * CI 机器上要多跑一轮
 * 「拉取 + 解密 + 渲染」，1s 会稳定误报；**本用例的目标是「会不会永远收不到」，
 * 不是精确测延迟**。实测延迟每次 console.log 出来，攒几次 run 能给出 P95。
 *
 * 另一个坑记在这：断言不能拿笔记标题做锚点。列表主标题列显示的是占位名「新笔记」，
 * 正文首行落在次级预览里，且预览会把连字符显示成空格——所以锚点用不含连字符的
 * 唯一 token，命中与否只取决于「这条笔记有没有出现在对端」。
 */
import { test, expect, type Page } from '@playwright/test';
import { TEST_PASSWORD } from './helpers';

/** 联机模式：全新库走注册，已有用户走解锁。与 online-flow.spec 同一分支策略。 */
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

/** 新建一条笔记，正文首行写入唯一 token；等它出现在本端列表里（自动保存 1.5s 防抖） */
async function writeNote(page: Page, token: string): Promise<void> {
  await page
    .getByRole('button', { name: /新建笔记|新笔记/ })
    .first()
    .click();
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10_000 });
  await page
    .locator('textarea')
    .first()
    .fill('# ' + token);
  await expect(page.getByText(token).first()).toBeVisible({ timeout: 15_000 });
}

/** 切到「全部笔记」列表视图，让对端条目一定出现在可断言的位置 */
async function showAllNotes(page: Page): Promise<void> {
  await page.getByText('全部笔记').first().click();
  await expect(page.getByRole('button', { name: /新建笔记|新笔记/ }).first()).toBeVisible();
}

test.describe('实时同步（WebSocket）', () => {
  test('A 端写入，B 端不刷新就能看到；反向同理', async ({ browser }) => {
    const stamp = Date.now().toString(36);

    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await enterOnline(pageA);

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await enterOnline(pageB);
    await showAllNotes(pageB);

    // 基线：先确认两端确实在同一账号、同一库上（B 看得见 A 之前写的东西）
    const n1 = `同步甲` + stamp;
    await writeNote(pageA, n1);
    // 写完落在编辑器视图，回到列表才能继续观察自己这端
    await showAllNotes(pageA);
    await expect(pageB.getByText(n1).first()).toBeVisible({ timeout: 15_000 });

    // 核心断言：B 停在列表页不做任何操作，A 的新笔记要自己冒出来。
    // 「不刷新、不切视图」是关键——中途导航会把「WS 推来的」与「切页时重新拉的」混为一谈。
    const n2 = `同步乙` + stamp;
    const t0 = Date.now();
    await pageA
      .getByRole(`button`, { name: /新建笔记|新笔记/ })
      .first()
      .click();
    await pageA
      .locator(`textarea`)
      .first()
      .fill(`# ` + n2);
    await pageB.getByText(n2).first().waitFor({ state: `visible`, timeout: 5000 });
    const elapsed = Date.now() - t0;
    // 端到端含 1.5s 自动保存防抖 + 300ms 广播防抖 + 一次拉取解密
    console.log(`[sync-e2e] A→B 端到端 ` + elapsed + `ms（含 1.5s 保存防抖）`);

    // 反向：先让 A 回到列表，再由 B 写——这样 A 这一侧同样是「停在列表页被动收到」，
    // 而不是靠切页时重新拉取看到。证明链路不是单向的。
    await showAllNotes(pageA);
    const n3 = `同步丙` + stamp;
    await pageB
      .getByRole(`button`, { name: /新建笔记|新笔记/ })
      .first()
      .click();
    await pageB
      .locator(`textarea`)
      .first()
      .fill(`# ` + n3);
    await pageA.getByText(n3).first().waitFor({ state: `visible`, timeout: 5000 });
    await ctxA.close();
    await ctxB.close();
  });
  /**
   * 这条不是同步用例，是写同步用例时当场撞出来的**丢数据**回归：
   * 在编辑器里打字后立刻切视图（概览 / 全部笔记 / 收藏 / 文件夹），
   * 800ms 防抖窗口内的内容会被 clearTimeout 掉且无人补存——实测 POST 之后一个 PATCH
   * 都没有，内容永久丢失。修复见 web/src/components/Editor.tsx 的卸载补存 effect。
   * 放在这个文件里是因为它和同步共用同一套「真实后端」夹具；名字写清楚，别当同步测试读。
   */
  test('打字后立刻切视图，未保存内容不许丢', async ({ page }) => {
    await enterOnline(page);
    await showAllNotes(page);
    const token = `别丢` + Date.now().toString(36);
    await page
      .getByRole(`button`, { name: /新建笔记|新笔记/ })
      .first()
      .click();
    await expect(page.locator(`textarea`).first()).toBeVisible({ timeout: 10_000 });
    await page
      .locator(`textarea`)
      .first()
      .fill(`#` + token);
    // 300ms 就切走：稳稳落在 800ms 防抖窗口内
    await page.waitForTimeout(300);
    await page.getByText(`概览`).first().click();
    await page.getByText(`全部笔记`).first().click();
    await expect(page.getByText(token).first()).toBeVisible({ timeout: 8000 });
    // 再刷新一次：只有真的存进服务端才可能活过 reload
    await page.reload();
    await page.waitForTimeout(2500);
    const pw = page.locator(`input[type="password"]`);
    if (
      await pw
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await pw.first().fill(TEST_PASSWORD);
      await page
        .getByRole(`button`, { name: /^解锁$/ })
        .first()
        .click();
      await page.waitForTimeout(2500);
    }
    await page.getByText(`全部笔记`).first().click();
    await expect(page.getByText(token).first()).toBeVisible({ timeout: 10_000 });
  });
});
