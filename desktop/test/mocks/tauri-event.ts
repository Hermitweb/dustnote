/** `@tauri-apps/api/event` 的测试替身：记录订阅并允许手动触发 */
import { vi } from 'vitest';

type Cb = (event: { payload: unknown }) => void;

const listeners = new Map<string, Cb[]>();

export const listen = vi.fn(async (event: string, cb: Cb) => {
  const arr = listeners.get(event) ?? [];
  arr.push(cb);
  listeners.set(event, arr);
  return () => {
    listeners.set(
      event,
      (listeners.get(event) ?? []).filter((x) => x !== cb)
    );
  };
});

/** 测试里模拟 Rust 侧发来的事件 */
export function emit(event: string, payload: unknown): void {
  for (const cb of listeners.get(event) ?? []) cb({ payload });
}

export function resetEvents(): void {
  listeners.clear();
  listen.mockClear();
}
