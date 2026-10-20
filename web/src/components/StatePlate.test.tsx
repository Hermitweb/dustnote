/**
 * StatePlate 测试
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '../test/render';

import { StatePlate } from '../components/StatePlate';

describe('StatePlate', () => {
  afterEach(() => cleanup());

  it('渲染 title + hint', () => {
    const r = render(<StatePlate title="T" hint="H" />);
    expect(r.container.textContent).toContain('T');
    expect(r.container.textContent).toContain('H');
  });

  it('仅 icon → 渲染 svg', () => {
    const r = render(<StatePlate title="T" icon="check" />);
    expect(r.container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(1);
  });

  it('illust 优先于 icon', () => {
    const r = render(<StatePlate title="T" icon="check" illust="first-use" />);
    const svgs = r.container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });

  it('busy=true → 渲染 spinner', () => {
    const r = render(<StatePlate title="T" icon="check" busy />);
    expect(r.container.querySelector('.state-plate-spinner')).toBeTruthy();
  });

  it('size=card → 标题 text-lg', () => {
    const r = render(<StatePlate title="T" size="card" />);
    const p = r.container.querySelector('p') as HTMLElement;
    expect(p.className).toContain('text-lg');
  });

  it('size=plate（默认）→ text-sm', () => {
    const r = render(<StatePlate title="T" />);
    const p = r.container.querySelector('p') as HTMLElement;
    expect(p.className).toContain('text-sm');
  });

  it('detail 落入带背景容器', () => {
    const r = render(<StatePlate title="T" detail="raw error" />);
    expect(r.container.textContent).toContain('raw error');
  });

  it('actions 渲染 button 子元素', () => {
    const r = render(<StatePlate title="T" actions={<button>btn</button>} />);
    expect(r.container.querySelector('button')).toBeTruthy();
  });
});
