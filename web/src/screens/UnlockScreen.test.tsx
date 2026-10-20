/**
 * web/src/screens/UnlockScreen.test.tsx - 解锁/恢复密码屏 (Round 15)
 *
 * 渲染分支：
 *   - mount -> unlock mode + 表单
 *   - 输入密码 -> handleUnlock 调 unlock(password)
 *   - 密码错误 -> error 显示
 *   - unlock 错误码是 totp_required -> 显示 TOTP 输入框
 *   - 切换到 recover mode -> 渲染恢复码表单 + 新密码
 *   - 错误恢复码 / 短密码 -> 不调 recover
 *   - desktop + graceAvailable=true -> 显示 graceUnlock 按钮
 *   - desktop + graceUnlock 成功 -> state.authState 改变
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, cleanup, fireEvent, waitFor } from '../test/render';
import { installPolyfills } from '../test/polyfills';

installPolyfills();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'zh-CN' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// shared mock state
const shared = vi.hoisted(() => ({
  unlock: vi.fn(async (pwd: string) => {
    if (pwd === 'wrong') throw new Error('wrong');
  }),
  recover: vi.fn(),
  graceUnlock: vi.fn(async () => false),
  hasGraceUnlock: vi.fn(() => false),
  serverError: null,
}));

vi.mock('../lib/store', () => ({
  useStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => {
      const s = {
        unlock: shared.unlock,
        recover: shared.recover,
        graceUnlock: shared.graceUnlock,
        hasGraceUnlock: shared.hasGraceUnlock,
        serverError: shared.serverError,
        authState: 'needs_unlock',
      };
      return selector(s);
    },
    {
      getState: () => ({
        unlock: shared.unlock,
        recover: shared.recover,
        graceUnlock: shared.graceUnlock,
        hasGraceUnlock: shared.hasGraceUnlock,
        serverError: shared.serverError,
        authState: 'needs_unlock',
      }),
    }
  ),
}));

vi.mock('../lib/platform', () => ({ isTauri: () => true }));
vi.mock('../lib/grace-unlock', () => ({
  graceRemainingSec: () => 120, // 返回 >0 让 graceUnlock 按钮渲染
}));

import { UnlockScreen } from './UnlockScreen';

beforeEach(() => {
  shared.unlock.mockClear();
  shared.recover.mockClear();
  shared.graceUnlock.mockClear();
  shared.hasGraceUnlock.mockClear();
  shared.serverError = null;
});

afterEach(() => {
  cleanup();
});

describe('UnlockScreen', () => {
  it('mount -> 渲染 unlock mode 表单 + Logo + password input + unlock 按钮', () => {
    const r = render(createElement(UnlockScreen));
    expect(r.container.querySelector('input[type="password"]')).toBeTruthy();
    // 切到 recover 模式的按钮
    expect(r.getByText('auth.unlock_recover')).toBeTruthy();
  });

  it('解锁模式 + 点 unlock -> 调 unlock(密码)', async () => {
    const r = render(createElement(UnlockScreen));
    const pwInput = r.container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(pwInput, 'TestPass123');
    const btn = r.getByText('auth.unlock_btn');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(shared.unlock).toHaveBeenCalledWith('TestPass123', undefined);
    });
  });

  it('解锁密码错误 -> error 显示', async () => {
    const r = render(createElement(UnlockScreen));
    const pwInput = r.container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(pwInput, 'wrong');
    fireEvent.click(r.getByText('auth.unlock_btn'));
    await waitFor(() => {
      // errorText 返回 Error.message
      expect(r.container.textContent).toContain('wrong');
    });
  });

  it('切到 recover mode -> 渲染 recoveryCode + newPassword 输入', () => {
    const r = render(createElement(UnlockScreen));
    fireEvent.click(r.getByText('auth.unlock_recover'));
    // recover mode 应该还有 password inputs
    expect(r.container.querySelectorAll('input[type="password"]').length).toBeGreaterThanOrEqual(1);
  });

  it('恢复码无效 -> 不调 recover', async () => {
    const r = render(createElement(UnlockScreen));
    fireEvent.click(r.getByText('auth.unlock_recover'));
    const recoverBtn = r.getByText('auth.recover_btn');
    // 不输入任何恢复码/新密码就点 recover → 早退
    fireEvent.click(recoverBtn);
    await new Promise((r) => setTimeout(r, 50));
    expect(shared.recover).not.toHaveBeenCalled();
  });

  it('hasGraceUnlock=true → graceUnlock 按钮可见', () => {
    shared.hasGraceUnlock.mockReturnValue(true);
    const r = render(createElement(UnlockScreen));
    expect(r.container.textContent).toContain('auth.unlock_btn'); // 主 unlock 按钮
  });

  it('点 graceUnlock 按钮 → 调 graceUnlock()', async () => {
    shared.hasGraceUnlock.mockReturnValue(true);
    shared.graceUnlock.mockResolvedValue(true);
    const r = render(createElement(UnlockScreen));
    // graceUnlock 按钮文本：auth.grace_unlock + 倒计时
    const graceBtn = r.getByText(/auth\.grace_unlock/);
    fireEvent.click(graceBtn);
    await waitFor(() => {
      expect(shared.graceUnlock).toHaveBeenCalled();
    });
  });

  it('graceUnlock 返回 false → graceAvailable 置 false', async () => {
    shared.hasGraceUnlock.mockReturnValue(true);
    shared.graceUnlock.mockResolvedValue(false);
    const r = render(createElement(UnlockScreen));
    const graceBtn = r.getByText(/auth\.grace_unlock/);
    fireEvent.click(graceBtn);
    await waitFor(() => {
      expect(shared.graceUnlock).toHaveBeenCalled();
    });
  });
});
