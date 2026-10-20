/**
 * Logo 测试
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '../test/render';

import { Logo } from '../components/Logo';

describe('Logo', () => {
  afterEach(() => cleanup());

  it('默认渲染 <img> 且 src=/logo.png', () => {
    const r = render(<Logo />);
    const img = r.container.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/logo.png');
    expect(img.getAttribute('alt')).toBe('DustNote');
  });

  it('onError 触发 → 回退到 Icon（notebook）', async () => {
    const r = render(<Logo />);
    const img = r.container.querySelector('img') as HTMLImageElement;
    await act(async () => {
      img.dispatchEvent(new Event('error'));
    });
    expect(r.container.querySelector('img')).toBeNull();
    expect(r.container.querySelector('svg')).not.toBeNull();
  });

  it('自定义 className / alt 透传', () => {
    const r = render(<Logo className="h-12 w-12" alt="alt-x" />);
    const img = r.container.querySelector('img') as HTMLImageElement;
    expect(img.className).toContain('h-12');
    expect(img.getAttribute('alt')).toBe('alt-x');
  });
});
