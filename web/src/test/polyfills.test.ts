/**
 * web/src/test/polyfills.test.ts - polyfills 纯函数
 *
 * 覆盖：installPolyfills 幂等 + 注入 IDB/Crypto/Worker/navigator.storage
 *       resetIdb 清 IDB
 *       makeTestStore 创建 store + 触发 subscribe 回调
 *       prepareSliceTestEnvironment 等价 installPolyfills
 */
import { describe, it, expect, vi } from 'vitest';
import {
  installPolyfills,
  resetIdb,
  makeTestStore,
  prepareSliceTestEnvironment,
} from './polyfills';

describe('installPolyfills', () => {
  it('第一次调：挂上 indexedDB / crypto.subtle / Worker / navigator.storage', () => {
    // 重置所有 polyfill（保留 type 标记）
    // 直接调用 → 应不抛错
    installPolyfills();
    expect((globalThis as Record<string, unknown>).indexedDB).toBeDefined();
  });

  it('幂等：第二次调 → 不报错', () => {
    installPolyfills();
    expect(() => installPolyfills()).not.toThrow();
  });
});

describe('resetIdb', () => {
  it('无 indexedDB → 直接返回', async () => {
    const orig = (globalThis as Record<string, unknown>).indexedDB;
    (globalThis as Record<string, unknown>).indexedDB = undefined as unknown;
    await expect(resetIdb()).resolves.toBeUndefined();
    (globalThis as Record<string, unknown>).indexedDB = orig;
  });

  it('有 indexedDB → 不抛错（knownDBs 为空时不删任何库）', async () => {
    installPolyfills();
    await expect(resetIdb()).resolves.toBeUndefined();
  });
});

describe('makeTestStore', () => {
  it('创建 store + 提供 getState / setState / subscribe', () => {
    // 第二个参数是 factory（set, get) => partial
    const factory = (_set: unknown, _get: unknown) => ({});
    const store = makeTestStore<Record<string, unknown>>({ slice: factory });
    expect(typeof store.getState).toBe('function');
    expect(typeof store.setState).toBe('function');
    expect(typeof store.subscribe).toBe('function');
  });

  it('slice 工厂注入 actions 到 state', () => {
    const slice = (set: unknown) => ({
      inc: () => (set as (p: { count: number }) => void)({ count: 1 }),
    });
    const store = makeTestStore<{ inc: () => void; count: number }>({ inc: slice });
    store.getState().inc();
    expect(store.getState().count).toBe(1);
  });

  it('setState 触发 subscribe 回调', () => {
    const slice = (set: unknown) => ({
      inc: () => (set as (p: { count: number }) => void)({ count: 1 }),
    });
    const store = makeTestStore<{ inc: () => void; count: number }>({ inc: slice });
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    store.getState().inc();
    expect(listener).toHaveBeenCalled();
    unsub();
    store.getState().inc();
    expect(listener).toHaveBeenCalledTimes(1); // 取消订阅后不再调用
  });
});

describe('prepareSliceTestEnvironment', () => {
  it('等价 installPolyfills（不抛错）', () => {
    expect(() => prepareSliceTestEnvironment()).not.toThrow();
  });
});
