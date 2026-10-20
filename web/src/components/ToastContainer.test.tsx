/**
 * ToastContainer 测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const store = vi.hoisted(() => ({
  toasts: [] as Array<{ id: string; kind: 'success' | 'error' | 'info'; message: string }>,
  dismiss: vi.fn(),
}));

vi.mock('../lib/toast', () => ({
  useToast: (selector: (s: typeof store) => unknown) => selector(store),
}));

import { ToastContainer } from '../components/ToastContainer';

describe('ToastContainer', () => {
  beforeEach(() => {
    store.toasts = [];
    store.dismiss.mockClear();
  });
  afterEach(() => cleanup());

  it('空 toasts → 不渲染', () => {
    const r = render(<ToastContainer />);
    expect(r.container.firstChild).toBeNull();
  });

  it('info toast → role=status', () => {
    store.toasts = [{ id: 't-1', kind: 'info', message: 'm' }];
    const r = render(<ToastContainer />);
    expect(r.container.querySelector('[role="status"]')).toBeTruthy();
    expect(r.container.textContent).toContain('m');
  });

  it('error toast → role=alert', () => {
    store.toasts = [{ id: 't-1', kind: 'error', message: 'm' }];
    const r = render(<ToastContainer />);
    expect(r.container.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('关闭按钮 → dismiss(id)', () => {
    store.toasts = [{ id: 't-x', kind: 'info', message: 'm' }];
    const r = render(<ToastContainer />);
    const close = r.container.querySelector('[aria-label="common.close"]') as HTMLElement;
    fireEvent.click(close);
    expect(store.dismiss).toHaveBeenCalledWith('t-x');
  });

  it('多个 toast → 全部渲染', () => {
    store.toasts = [
      { id: 'a', kind: 'success', message: 'ok' },
      { id: 'b', kind: 'info', message: 'msg' },
    ];
    const r = render(<ToastContainer />);
    expect(
      r.container.querySelectorAll('[role="status"], [role="alert"]').length
    ).toBeGreaterThanOrEqual(2);
    expect(r.container.textContent).toContain('ok');
    expect(r.container.textContent).toContain('msg');
  });
});
