/**
 * RailLabelTip 测试
 *
 * 覆盖：
 * - 默认无 tip 时不渲染浮层
 * - matchMedia 命中且 pointerover 时弹出 portal
 * - pointerleave / focusout 时清除浮层
 * - 不在 mini 区间时即使有 holder 也不弹
 * - holder 缺 data-rail-label 时不弹
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '../test/render';

/**
 * RailLabelTip 的 root 形参是 RefObject<HTMLElement | null>，而 React 18 的
 * createRef 返回的 current 是只读属性（TS2540：不能给只读属性赋值）。
 * 这里改用可变的普通对象，运行时行为一致——组件只读 root.current。
 */
function makeRoot(): { current: HTMLDivElement | null } {
  return { current: null };
}

function mockMatchMedia(initialMatches: boolean) {
  const listeners: Array<(e: { matches: boolean }) => void> = [];
  const mq = {
    matches: initialMatches,
    media: '',
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
      listeners.push(cb);
    },
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent: () => true,
  };
  (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = vi
    .fn()
    .mockReturnValue(mq);
  return {
    fire: (matches: boolean) => {
      mq.matches = matches;
      listeners.forEach((cb) => cb({ matches }));
    },
  };
}

const FALLBACK_RECT = {
  top: 0,
  right: 10,
  bottom: 10,
  left: 0,
  width: 10,
  height: 10,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

/**
 * 直接调用挂载在 container 上的 listener，绕开 jsdom 对 pointer* 事件的支持差异
 * （真实路径仍由 useEffect 注册，验证我们假设的 "注册 → 触发 → 设置 tip" 链路）
 */
function triggerListener(
  container: HTMLElement,
  type: 'pointerover' | 'pointerleave' | 'focusin' | 'focusout',
  target: Element
) {
  // dispatchEvent 派发后让 React 的 setState 同步刷新
  act(() => {
    container.dispatchEvent(new Event(type, { bubbles: true }));
  });
  void target;
}

describe('RailLabelTip', () => {
  afterEach(() => cleanup());

  it('默认无 tip 时不渲染浮层', async () => {
    mockMatchMedia(true);
    const { RailLabelTip } = await import('./RailLabelTip');
    const root = makeRoot();
    const container = document.createElement('div');
    container.setAttribute('data-rail-label', 'X');
    document.body.appendChild(container);
    root.current = container;

    const { container: out } = render(<RailLabelTip root={root} />);
    expect(out.querySelector('.rail-tip')).toBeNull();
  });

  it('mini 区间内 pointerover 含 data-rail-label 的元素会渲染 portal', async () => {
    mockMatchMedia(true);
    const { RailLabelTip } = await import('./RailLabelTip');
    const root = makeRoot();
    const container = document.createElement('div');
    container.setAttribute('data-rail-label', '笔记');
    document.body.appendChild(container);
    const target = document.createElement('span');
    target.textContent = 'N';
    container.appendChild(target);
    root.current = container;
    container.getBoundingClientRect = () => ({ ...FALLBACK_RECT, top: 10, right: 50, height: 20 });

    const { container: out } = render(<RailLabelTip root={root} />);
    triggerListener(container, 'pointerover', target);

    const tip = document.body.querySelector('.rail-tip');
    expect(tip).not.toBeNull();
    expect(tip?.textContent).toBe('笔记');
    expect(tip?.getAttribute('aria-hidden')).toBe('true');
    void out;
  });

  it('pointerleave 时清掉浮层', async () => {
    mockMatchMedia(true);
    const { RailLabelTip } = await import('./RailLabelTip');
    const root = makeRoot();
    const container = document.createElement('div');
    container.setAttribute('data-rail-label', 'Y');
    document.body.appendChild(container);
    const target = document.createElement('span');
    container.appendChild(target);
    root.current = container;
    container.getBoundingClientRect = () => FALLBACK_RECT;

    render(<RailLabelTip root={root} />);
    triggerListener(container, 'pointerover', target);
    expect(document.body.querySelector('.rail-tip')).not.toBeNull();
    triggerListener(container, 'pointerleave', target);
    expect(document.body.querySelector('.rail-tip')).toBeNull();
  });

  it('不在 mini 区间时不弹', async () => {
    mockMatchMedia(false);
    const { RailLabelTip } = await import('./RailLabelTip');
    const root = makeRoot();
    const container = document.createElement('div');
    container.setAttribute('data-rail-label', 'Z');
    document.body.appendChild(container);
    const target = document.createElement('span');
    container.appendChild(target);
    root.current = container;

    render(<RailLabelTip root={root} />);
    triggerListener(container, 'pointerover', target);
    expect(document.body.querySelector('.rail-tip')).toBeNull();
  });

  it('holder 没有 data-rail-label 时不弹', async () => {
    mockMatchMedia(true);
    const { RailLabelTip } = await import('./RailLabelTip');
    const root = makeRoot();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const target = document.createElement('span');
    container.appendChild(target);
    root.current = container;

    render(<RailLabelTip root={root} />);
    triggerListener(container, 'pointerover', target);
    expect(document.body.querySelector('.rail-tip')).toBeNull();
  });

  it('focusin / focusout 能触发显示与隐藏', async () => {
    mockMatchMedia(true);
    const { RailLabelTip } = await import('./RailLabelTip');
    const root = makeRoot();
    const container = document.createElement('div');
    container.setAttribute('data-rail-label', 'F');
    document.body.appendChild(container);
    const target = document.createElement('input');
    container.appendChild(target);
    root.current = container;
    container.getBoundingClientRect = () => FALLBACK_RECT;

    render(<RailLabelTip root={root} />);
    triggerListener(container, 'focusin', target);
    expect(document.body.querySelector('.rail-tip')).not.toBeNull();
    triggerListener(container, 'focusout', target);
    expect(document.body.querySelector('.rail-tip')).toBeNull();
  });

  it('matchMedia 变化时同步 mini 状态；区间外清空已有 tip', async () => {
    const mq = mockMatchMedia(true);
    const { RailLabelTip } = await import('./RailLabelTip');
    const root = makeRoot();
    const container = document.createElement('div');
    container.setAttribute('data-rail-label', 'S');
    document.body.appendChild(container);
    const target = document.createElement('span');
    container.appendChild(target);
    root.current = container;
    container.getBoundingClientRect = () => FALLBACK_RECT;

    render(<RailLabelTip root={root} />);
    triggerListener(container, 'pointerover', target);
    expect(document.body.querySelector('.rail-tip')).not.toBeNull();

    // 同步触发 setTip(null)，需 act 让 React 立刻刷新
    act(() => {
      mq.fire(false);
    });
    expect(document.body.querySelector('.rail-tip')).toBeNull();
  });
});
