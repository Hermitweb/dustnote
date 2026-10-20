/**
 * Cheatsheet 测试
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('../lib/platform', () => ({
  isTauri: () => false,
}));

import { Cheatsheet } from '../components/Cheatsheet';

describe('Cheatsheet', () => {
  afterEach(() => cleanup());

  it('默认隐藏（open=false）', () => {
    const r = render(<Cheatsheet />);
    expect(r.container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('F1 唤起 → 渲染 Modal + 快捷键条目', () => {
    const r = render(<Cheatsheet />);
    fireEvent.keyDown(window, 'F1');
    expect(r.container.querySelector('[role="dialog"]')).toBeTruthy();
    expect(r.container.textContent).toContain('cheatsheet.title');
    expect(r.container.querySelectorAll('kbd').length).toBeGreaterThanOrEqual(1);
  });

  it('再次 F1 → 关闭', () => {
    const r = render(<Cheatsheet />);
    fireEvent.keyDown(window, 'F1');
    expect(r.container.querySelector('[role="dialog"]')).toBeTruthy();
    fireEvent.keyDown(window, 'F1');
    expect(r.container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('打开后按 Escape 关闭', () => {
    const r = render(<Cheatsheet />);
    fireEvent.keyDown(window, 'F1');
    fireEvent.keyDown(window, 'Escape');
    expect(r.container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('包含关键快捷键文本', () => {
    const r = render(<Cheatsheet />);
    fireEvent.keyDown(window, 'F1');
    for (const key of ['Ctrl+N', 'Ctrl+S', 'Ctrl+F', 'Ctrl+B', 'Ctrl+,', 'Ctrl+L']) {
      expect(r.container.textContent).toContain(key);
    }
  });
});
