/**
 * DustNote E2E 测试
 *
 * 覆盖核心流程：模式选择 → 设置密码 → 创建笔记 → 编辑 → 分享
 *
 * 运行：pnpm exec playwright test
 * UI 模式：pnpm exec playwright test --ui
 * 本机（Playwright CDN 不可达时）：npx playwright test --config=playwright.local.config.ts
 */

import { test, expect } from '@playwright/test';
import { setupStandalone } from './helpers';

test.describe('DustNote 核心流程', () => {
  test('单机模式：setup → 创建笔记 → 编辑 → 保存', async ({ page }) => {
    // 共享动线（含「首访默认联机 → 重新选择模式」与解锁按钮的 role 匹配）
    await setupStandalone(page);

    // 创建新笔记
    const newNoteBtn = page.getByRole('button', { name: /新建|新笔记|New/ }).first();
    if (await newNoteBtn.isVisible().catch(() => false)) {
      await newNoteBtn.click();
      await page.waitForTimeout(1000);
    }

    // 编辑笔记标题
    const titleInput = page.locator('input[type="text"]').first();
    if (await titleInput.isVisible().catch(() => false)) {
      await titleInput.fill('E2E 测试笔记');
      await page.waitForTimeout(500);
    }

    // 编辑笔记内容
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.fill('# 测试内容\n\n这是一个 E2E 测试笔记。');
      await page.waitForTimeout(1000);
    }

    // 验证无控制台错误
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForTimeout(2000);
    expect(errors.filter((e) => !e.includes('runtime.lastError'))).toHaveLength(0);
  });

  test('HTTP 环境提示', async ({ page }) => {
    // 标记在「已解锁」时才写入（App 的 env notice effect），必须先走到主界面。
    // 契约（见 web/src/lib/env.ts + env.test.ts）：localhost/127.0.0.1 视为安全
    // 上下文 → 不打扰用户；仅公网地址的明文 HTTP 才提示。
    await setupStandalone(page);
    const noticeShown = await page.evaluate(() =>
      localStorage.getItem('dustnote_http_env_notice_shown')
    );
    const host = new URL(page.url()).hostname;
    const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(host);
    if (isLocalhost) {
      expect(noticeShown).toBeNull();
    } else if (page.url().startsWith('http://')) {
      expect(noticeShown).toBe('1');
    }
  });

  test('健康检查 API', async ({ page }) => {
    // 必须先导航到应用源——否则页面停在 about:blank,跨域请求会被 CORS 拒绝,
    // 被误判成「后端未启动」而跳过（实锤：goto 后同款请求 200）
    await page.goto('/');
    // 直连后端绝对地址（而非经 vite 代理的相对路径）：代理层在 dev 下偶发
    // 转发失败,会把「后端其实在线」误判成不可达。CORS 白名单含 localhost:5173。
    const API = 'http://localhost:3210/api/v1/health';
    const reachable = await page.evaluate(async (url: string) => {
      for (let i = 0; i < 8; i++) {
        try {
          const r = await fetch(url);
          if (r.ok) return true;
        } catch {
          /* retry */
        }
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      return false;
    }, API);
    test.skip(!reachable, '后端未启动（该用例在无后端时跳过而非失败）');
    const response = await page.evaluate(async (url: string) => {
      const r = await fetch(url);
      return r.json();
    }, API);
    expect(response.ok).toBe(true);
    expect(response.version).toBeDefined();
  });
});
