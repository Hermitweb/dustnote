/**
 * QuickCapture 测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const store = vi.hoisted(() => ({
  createNote: vi.fn(async () => 'new-id'),
  updateNote: vi.fn(async () => undefined),
}));

vi.mock('../lib/store', () => ({
  useStore: Object.assign((selector: (s: typeof store) => unknown) => selector(store), {
    getState: () => store,
  }),
}));
vi.mock('../lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { QuickCapture } from '../components/QuickCapture';

describe('QuickCapture', () => {
  beforeEach(() => {
    store.createNote.mockClear();
    store.updateNote.mockClear();
  });
  afterEach(() => cleanup());

  it('渲染 title input + content textarea + 保存按钮', () => {
    const r = render(<QuickCapture onClose={() => undefined} />);
    expect(r.container.querySelector('input')).toBeTruthy();
    expect(r.container.querySelector('textarea')).toBeTruthy();
    expect(r.container.textContent).toContain('quick_capture.hint');
  });

  it('空内容 → Esc 直接关闭', () => {
    const onClose = vi.fn();
    render(<QuickCapture onClose={onClose} />);
    fireEvent.keyDown(window, 'Escape');
    expect(onClose).toHaveBeenCalled();
    expect(store.createNote).not.toHaveBeenCalled();
  });

  it('点保存 → createNote + updateNote + 关闭', async () => {
    const onClose = vi.fn();
    const r = render(<QuickCapture onClose={onClose} />);
    const titleInput = r.container.querySelector('input') as HTMLInputElement;
    fireEvent.change(titleInput, '我的灵感');
    const ta = r.container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(ta, '内容');
    const saveBtn = Array.from(r.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('common.save')
    ) as HTMLElement;
    fireEvent.click(saveBtn);
    await new Promise((rr) => setTimeout(rr, 50));
    expect(store.createNote).toHaveBeenCalled();
    expect(store.updateNote).toHaveBeenCalledWith('new-id', {
      title: '我的灵感',
      content: '内容',
    });
    expect(onClose).toHaveBeenCalled();
  });
});
