/**
 * StandaloneUnlockScreen 测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => (opts?.sec ? `${k}:${opts.sec}` : k),
    i18n: { language: 'zh-CN' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('../lib/platform', () => ({ isTauri: () => false }));
vi.mock('../lib/grace-unlock', () => ({ graceRemainingSec: () => 0 }));

const store = vi.hoisted(() => ({
  unlockStandalone: vi.fn(async () => undefined),
  getRemainingLockoutMs: vi.fn(() => 0),
  graceUnlock: vi.fn(async () => true),
  hasGraceUnlock: vi.fn(() => false),
}));

vi.mock('../lib/store', () => ({
  useStore: Object.assign((selector: (s: typeof store) => unknown) => selector(store), {
    getState: () => store,
  }),
}));

import { StandaloneUnlockScreen } from '../screens/StandaloneUnlockScreen';

describe('StandaloneUnlockScreen', () => {
  beforeEach(() => {
    store.unlockStandalone.mockClear();
    store.getRemainingLockoutMs.mockReturnValue(0);
  });
  afterEach(() => cleanup());

  it('标题 + 单机模式提示', () => {
    const r = render(<StandaloneUnlockScreen onRecover={() => undefined} />);
    expect(r.container.textContent).toContain('auth.unlock_title');
    expect(r.container.textContent).toContain('settings.app_mode_standalone');
  });

  it('密码空 → 提交按钮 disabled', () => {
    const r = render(<StandaloneUnlockScreen onRecover={() => undefined} />);
    const submit = r.container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('输入密码 + 提交 → unlockStandalone 调用', async () => {
    const r = render(<StandaloneUnlockScreen onRecover={() => undefined} />);
    const pwd = r.container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(pwd, 'mypwd');
    fireEvent.submit(r.container.querySelector('form') as HTMLFormElement);
    await new Promise((rr) => setTimeout(rr, 16));
    expect(store.unlockStandalone).toHaveBeenCalledWith('mypwd');
  });

  it('点击 onRecover 触发', () => {
    const onRecover = vi.fn();
    const r = render(<StandaloneUnlockScreen onRecover={onRecover} />);
    const btn = Array.from(r.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('auth.unlock_recover')
    ) as HTMLElement;
    fireEvent.click(btn);
    expect(onRecover).toHaveBeenCalled();
  });
});
