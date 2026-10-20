/**
 * MenuItem 测试
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { MenuItem } from '../components/MenuItem';

describe('MenuItem', () => {
  afterEach(() => cleanup());

  it('传 label → 渲染 label', () => {
    const r = render(<MenuItem label="你好" onClick={() => undefined} />);
    expect(r.container.textContent).toContain('你好');
  });

  it('传 k → i18n 翻译 + Icon 渲染', () => {
    const r = render(<MenuItem k="menu.copy" onClick={() => undefined} />);
    expect(r.container.textContent).toContain('menu.copy');
    expect(r.container.querySelector('button')).toBeTruthy();
  });

  it('点击 → onClick 触发', () => {
    const onClick = vi.fn();
    const r = render(<MenuItem label="X" onClick={onClick} />);
    fireEvent.click(r.container.querySelector('button') as HTMLElement);
    expect(onClick).toHaveBeenCalled();
  });

  it('danger=true → 红色样式', () => {
    const r = render(<MenuItem label="X" onClick={() => undefined} danger />);
    const btn = r.container.querySelector('button') as HTMLElement;
    expect(btn.className).toContain('text-danger');
  });

  it('danger=false → 普通样式', () => {
    const r = render(<MenuItem label="X" onClick={() => undefined} />);
    const btn = r.container.querySelector('button') as HTMLElement;
    expect(btn.className).toContain('text-surface-fg');
  });
});
