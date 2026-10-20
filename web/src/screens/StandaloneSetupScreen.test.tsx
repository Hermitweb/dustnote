/**
 * StandaloneSetupScreen 测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const store = vi.hoisted(() => ({
  setupStandalone: vi.fn(async () => 'RC-STANDALONE'),
}));

vi.mock('../lib/store', () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

import { StandaloneSetupScreen } from '../screens/StandaloneSetupScreen';

describe('StandaloneSetupScreen', () => {
  beforeEach(() => store.setupStandalone.mockClear());
  afterEach(() => cleanup());

  it('渲染标题 + 单机模式提示', () => {
    const r = render(<StandaloneSetupScreen />);
    expect(r.container.textContent).toContain('auth.setup_title');
    expect(r.container.textContent).toContain('settings.app_mode_standalone');
  });

  it('两个密码字段', () => {
    const r = render(<StandaloneSetupScreen />);
    expect(r.container.querySelectorAll('input[type="password"]').length).toBe(2);
  });

  it('不一致 → mismatch', () => {
    const r = render(<StandaloneSetupScreen />);
    const ins = Array.from(
      r.container.querySelectorAll('input[type="password"]')
    ) as HTMLInputElement[];
    fireEvent.change(ins[0]!, 'abcdef1');
    fireEvent.change(ins[1]!, 'abcdef2');
    expect(r.container.textContent).toContain('auth.mismatch');
  });

  it('弱密码 → too_weak + 提交按钮 disabled', () => {
    const r = render(<StandaloneSetupScreen />);
    const ins = Array.from(
      r.container.querySelectorAll('input[type="password"]')
    ) as HTMLInputElement[];
    fireEvent.change(ins[0]!, 'ab');
    expect(r.container.textContent).toContain('auth.too_weak');
    const submit = r.container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('一致且足够 → 提交调用 setupStandalone', async () => {
    const r = render(<StandaloneSetupScreen />);
    const ins = Array.from(
      r.container.querySelectorAll('input[type="password"]')
    ) as HTMLInputElement[];
    fireEvent.change(ins[0]!, 'abcdef1');
    fireEvent.change(ins[1]!, 'abcdef1');
    fireEvent.submit(r.container.querySelector('form') as HTMLFormElement);
    await new Promise((rr) => setTimeout(rr, 16));
    expect(store.setupStandalone).toHaveBeenCalledWith('abcdef1');
  });
});
