/**
 * 轻量级 React 组件渲染测试工具
 *
 * 为什么不直接用 @testing-library/react：
 *   本仓库 .npmrc 使用 node-linker=hoisted（RN 兼容），hoist 布局曾让
 *   react@18.3.1（web）与 react@18.2.0（RN 钉死）共存，externalized
 *   react-dom 内部 require('react') 与组件实例分裂。现 web 已把
 *   react / react-dom 钉到 18.2.0（见 vitest.config.ts 注释），全仓单一
 *   react 实例，这里直接用 react-dom/client + act + flushSync
 *   （与正常渲染同路径）即可。
 *   act 从 react-dom/test-utils 导入（react 18.2.x 无 act 导出，
 *   React 18.3.0 起 react 才提供 act）。
 *
 * 提供 render / screen / fireEvent / waitFor / act / cleanup，
 * 覆盖组件测试常用场景。API 风格对齐 @testing-library/react，便于后续迁移。
 */

import { createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { act } from 'react-dom/test-utils';

export interface RenderResult {
  container: HTMLElement;
  /** 按文本内容查找单个元素 */
  getByText: (text: string | RegExp) => HTMLElement;
  /** 按文本内容查找全部元素 */
  getAllByText: (text: string | RegExp) => HTMLElement[];
  /** 按文本内容查找单个元素，未找到返回 null */
  queryByText: (text: string | RegExp) => HTMLElement | null;
  /** 按文本内容查找全部元素，未找到返回空数组 */
  queryAllByText: (text: string | RegExp) => HTMLElement[];
  /** 按 aria-label 或 text 查找按钮 */
  getByRole: (role: string, opts?: { name?: string | RegExp }) => HTMLElement;
  /** 按 placeholder 查找 */
  getByPlaceholderText: (text: string | RegExp) => HTMLElement;
  /** 按测试 id 查找 */
  getByTestId: (id: string) => HTMLElement;
  /** 重新渲染 */
  rerender: (ui: ReactElement) => void;
  /** 卸载 */
  unmount: () => void;
}

/** 当前渲染容器，供 screen.* 在不传 container 时使用 */
let current: RenderResult | null = null;

function matchText(el: HTMLElement, matcher: string | RegExp): boolean {
  const text = el.textContent ?? '';
  return typeof matcher === 'string' ? text.includes(matcher) : matcher.test(text);
}

function queryByText(container: HTMLElement, matcher: string | RegExp): HTMLElement[] {
  const all = Array.from(container.querySelectorAll('*')) as HTMLElement[];
  // 优先返回叶子元素（无元素子节点）的匹配，避免父容器因包含子节点文本而被重复计入。
  // 例如版本列表里多个 version_label 文本，父级 button/容器也会包含这些文本，
  // 只取叶子才能让 getAllByText 返回精确数量。
  const leaves = all.filter((el) => el.children.length === 0 && matchText(el, matcher));
  return leaves.length > 0 ? leaves : all.filter((el) => matchText(el, matcher));
}

function buildScreen(container: HTMLElement): Omit<RenderResult, 'rerender' | 'unmount'> {
  return {
    container,
    getByText(matcher: string | RegExp): HTMLElement {
      const found = queryByText(container, matcher);
      const exact = found.filter((el) => el.children.length === 0);
      const target = (exact.length ? exact : found)[0];
      if (!target) throw new Error(`getByText: 未找到匹配 "${matcher}" 的元素`);
      return target;
    },
    getAllByText(matcher: string | RegExp): HTMLElement[] {
      const found = queryByText(container, matcher);
      if (!found.length) throw new Error(`getAllByText: 未找到匹配 "${matcher}" 的元素`);
      return found;
    },
    queryByText(matcher: string | RegExp): HTMLElement | null {
      const found = queryByText(container, matcher);
      const exact = found.filter((el) => el.children.length === 0);
      return (exact.length ? exact : found)[0] ?? null;
    },
    queryAllByText(matcher: string | RegExp): HTMLElement[] {
      return queryByText(container, matcher);
    },
    getByRole(role: string, opts?: { name?: string | RegExp }): HTMLElement {
      const candidates = Array.from(container.querySelectorAll(`[role="${role}"],button,a,input,[role]`)) as HTMLElement[];
      const byRole = candidates.filter((el) => {
        const r = el.getAttribute('role') ?? implicitRole(el);
        return r === role;
      });
      if (!opts?.name) {
        if (!byRole[0]) throw new Error(`getByRole: 未找到 role="${role}"`);
        return byRole[0];
      }
      const nameMatcher = opts.name;
      const hit = byRole.find((el) => {
        const label = el.getAttribute('aria-label') ?? el.textContent ?? '';
        return typeof nameMatcher === 'string' ? label.includes(nameMatcher) : nameMatcher.test(label);
      });
      if (!hit) throw new Error(`getByRole: 未找到 role="${role}" name="${String(nameMatcher)}"`);
      return hit;
    },
    getByPlaceholderText(matcher: string | RegExp): HTMLElement {
      const all = Array.from(container.querySelectorAll('[placeholder]')) as HTMLElement[];
      const hit = all.find((el) => {
        const p = el.getAttribute('placeholder') ?? '';
        return typeof matcher === 'string' ? p.includes(matcher) : matcher.test(p);
      });
      if (!hit) throw new Error(`getByPlaceholderText: 未找到 "${matcher}"`);
      return hit;
    },
    getByTestId(id: string): HTMLElement {
      const el = container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
      if (!el) throw new Error(`getByTestId: 未找到 "${id}"`);
      return el;
    },
  };
}

function implicitRole(el: HTMLElement): string | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'input') return 'textbox';
  return el.getAttribute('role');
}

export function render(ui: ReactElement): RenderResult {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    flushSync(() => {
      root.render(ui);
    });
  });

  const screen = buildScreen(container);
  const result: RenderResult = {
    ...screen,
    rerender(next: ReactElement) {
      act(() => {
        flushSync(() => {
          root.render(next);
        });
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
  current = result;
  return result;
}

/** 事件触发：click / change / keyDown 等 */
export const fireEvent = {
  click(el: HTMLElement): void {
    act(() => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  },
  change(el: HTMLInputElement, value: string): void {
    act(() => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  },
  keyDown(el: HTMLElement | Window, key: string): void {
    act(() => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
  },
  async clickAsync(el: HTMLElement): Promise<void> {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  },
};

/** 轮询等待断言通过，超时抛错（对齐 @testing-library waitFor 语义） */
export async function waitFor<T>(fn: () => T | Promise<T>, opts: { timeout?: number; interval?: number } = {}): Promise<T> {
  const timeout = opts.timeout ?? 2000;
  const interval = opts.interval ?? 16;
  const start = Date.now();
  let lastErr: unknown;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // 用 act 包裹：若有异步状态更新（fetch 回调 setState），act 会刷新并消除
    // "An update ... was not wrapped in act(...)" 警告。
    let result: T | undefined;
    let threw = false;
    await act(async () => {
      try {
        result = await fn();
      } catch (err) {
        lastErr = err;
        threw = true;
      }
    });
    if (!threw) return result as T;
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor 超时（${timeout}ms）：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** 清理所有渲染容器 */
export function cleanup(): void {
  if (current) {
    try {
      current.unmount();
    } catch {
      /* 忽略已卸载 */
    }
    current = null;
  }
  document.body.innerHTML = '';
}

export { act, createElement };
