/**
 * ThemeCard 测试
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { ThemeCard } from '../components/ThemeCard';

describe('ThemeCard', () => {
  afterEach(() => cleanup());

  it('渲染主题名（来自 i18n key）', () => {
    const r = render(<ThemeCard id="mint-dawn" selected={false} onSelect={() => undefined} />);
    expect(r.container.textContent).toContain('settings.theme_mint-dawn');
  });

  it('未选中 → aria-pressed=false + 非 accent border', () => {
    const r = render(<ThemeCard id="mint-dawn" selected={false} onSelect={() => undefined} />);
    const btn = r.container.querySelector('button') as HTMLElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.className).toContain('border-surface-border');
  });

  it('选中 → aria-pressed=true + accent border + 徽标 svg', () => {
    const r = render(<ThemeCard id="mint-dawn" selected={true} onSelect={() => undefined} />);
    const btn = r.container.querySelector('button') as HTMLElement;
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.className).toContain('border-accent');
    expect(btn.querySelectorAll('svg').length).toBeGreaterThanOrEqual(1);
  });

  it('点击 → onSelect 触发', () => {
    const onSelect = vi.fn();
    const r = render(<ThemeCard id="mint-dawn" selected={false} onSelect={onSelect} />);
    fireEvent.click(r.container.querySelector('button') as HTMLElement);
    expect(onSelect).toHaveBeenCalled();
  });
});
