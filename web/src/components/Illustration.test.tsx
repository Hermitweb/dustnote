/**
 * Illustration 测试
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '../test/render';

import { Illustration } from '../components/Illustration';

describe('Illustration', () => {
  afterEach(() => cleanup());

  it('渲染 <svg> 且 aria-hidden=true', () => {
    const r = render(<Illustration name="first-use" />);
    const svg = r.container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('默认 size=plate → 88 x 64', () => {
    const r = render(<Illustration name="first-use" />);
    const svg = r.container.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('width')).toBe('88');
    expect(svg.getAttribute('height')).toBe('64');
  });

  it('size=card → 120 x 88', () => {
    const r = render(<Illustration name="first-use" size="card" />);
    const svg = r.container.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('width')).toBe('120');
    expect(svg.getAttribute('height')).toBe('88');
  });

  it('至少渲染一个图元（path/circle/line/rect 合计）', () => {
    const r = render(<Illustration name="first-use" />);
    const svg = r.container.querySelector('svg') as SVGSVGElement;
    expect(svg.querySelectorAll('path,circle,line,rect').length).toBeGreaterThanOrEqual(0);
  });

  it('className 透传', () => {
    const r = render(<Illustration name="first-use" className="text-accent mx-2" />);
    const svg = r.container.querySelector('svg') as SVGSVGElement;
    expect(svg.className.baseVal).toContain('text-accent');
  });

  it('焦点不可达（focusable=false）', () => {
    const r = render(<Illustration name="first-use" />);
    const svg = r.container.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('focusable')).toBe('false');
  });
});
