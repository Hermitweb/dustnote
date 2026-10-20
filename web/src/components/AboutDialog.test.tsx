/**
 * AboutDialog 测试
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('../lib/platform', () => ({
  isTauri: () => false,
}));

import { AboutDialog } from '../components/AboutDialog';

describe('AboutDialog', () => {
  afterEach(() => cleanup());

  it('渲染 Modal + 版本号', () => {
    const r = render(<AboutDialog onClose={() => undefined} />);
    expect(r.container.querySelector('[role="dialog"]')).toBeTruthy();
    expect(r.container.textContent).toContain('settings.version');
  });

  it('Esc → onClose', () => {
    const onClose = vi.fn();
    render(<AboutDialog onClose={onClose} />);
    fireEvent.keyDown(window, 'Escape');
    expect(onClose).toHaveBeenCalled();
  });

  it('GitHub 链接点击 → 阻止默认 + window.open', () => {
    const open = vi.fn();
    window.open = open;
    const r = render(<AboutDialog onClose={() => undefined} />);
    const links = Array.from(r.container.querySelectorAll('a'));
    const gh = links.find((a) => a.getAttribute('href')?.includes('github.com')) as HTMLElement;
    expect(gh).toBeTruthy();
    fireEvent.click(gh);
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('github.com'),
      '_blank',
      expect.any(String)
    );
  });

  it('底部"关闭"按钮触发 onClose', () => {
    const onClose = vi.fn();
    const r = render(<AboutDialog onClose={onClose} />);
    const btns = Array.from(r.container.querySelectorAll('button'));
    const close = btns[btns.length - 1] as HTMLElement;
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalled();
  });

  it('渲染隐私 / 服务条款 / 许可 链接', () => {
    const r = render(<AboutDialog onClose={() => undefined} />);
    expect(r.container.textContent).toContain('隐私政策');
    expect(r.container.textContent).toContain('服务条款');
    expect(r.container.textContent).toContain('开源许可');
  });
});
