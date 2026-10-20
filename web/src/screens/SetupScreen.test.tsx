/**
 * SetupScreen（联机）测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const store = vi.hoisted(() => ({
  setup: vi.fn(async () => 'RC-ABCD'),
}));

vi.mock('../lib/store', () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

import { SetupScreen } from '../screens/SetupScreen';

describe('SetupScreen（联机）', () => {
  beforeEach(() => store.setup.mockClear());
  afterEach(() => cleanup());

  it('渲染表单 + 两个密码字段', () => {
    const r = render(<SetupScreen />);
    expect(r.container.textContent).toContain('auth.setup_title');
    expect(r.container.querySelectorAll('input[type="password"]').length).toBe(2);
  });

  it('弱密码 → too_weak 错误 + 提交按钮 disabled', () => {
    const r = render(<SetupScreen />);
    const ins = Array.from(
      r.container.querySelectorAll('input[type="password"]')
    ) as HTMLInputElement[];
    fireEvent.change(ins[0]!, '123');
    expect(r.container.textContent).toContain('auth.too_weak');
    const submit = r.container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('两次密码不一致 → mismatch', () => {
    const r = render(<SetupScreen />);
    const ins = Array.from(
      r.container.querySelectorAll('input[type="password"]')
    ) as HTMLInputElement[];
    fireEvent.change(ins[0]!, 'secret123');
    fireEvent.change(ins[1]!, 'different');
    expect(r.container.textContent).toContain('auth.mismatch');
  });

  it('两次一致且足够长 → 提交调用 setup', async () => {
    const r = render(<SetupScreen />);
    const ins = Array.from(
      r.container.querySelectorAll('input[type="password"]')
    ) as HTMLInputElement[];
    fireEvent.change(ins[0]!, 'correctpwd123');
    fireEvent.change(ins[1]!, 'correctpwd123');
    fireEvent.submit(r.container.querySelector('form') as HTMLFormElement);
    await new Promise((rr) => setTimeout(rr, 16));
    expect(store.setup).toHaveBeenCalledWith('correctpwd123');
  });

  it('setup 抛错 → 显示错误文案', async () => {
    store.setup.mockRejectedValueOnce(new Error('boom'));
    const r = render(<SetupScreen />);
    const ins = Array.from(
      r.container.querySelectorAll('input[type="password"]')
    ) as HTMLInputElement[];
    fireEvent.change(ins[0]!, 'correctpwd123');
    fireEvent.change(ins[1]!, 'correctpwd123');
    fireEvent.submit(r.container.querySelector('form') as HTMLFormElement);
    await new Promise((rr) => setTimeout(rr, 16));
    expect(r.container.textContent).toMatch(/boom|错误|error/);
  });
});
