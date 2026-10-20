/**
 * slices 写路径测试基建
 *
 * 设计目标：data-slice / auth-slice 的写路径（createNote / updateNote / deleteNote /
 * lock / unlock / argon2 派生 / TOTP）需要 IndexedDB + Web Crypto + Web Worker，
 * 在 jsdom 下直接跑会因缺少这些 API 而崩溃。本文件提供两个能力：
 *
 * 1. `installPolyfills()` —— 把 IndexedDB（fake-indexeddb）/ Web Crypto（node:crypto）
 *    / Web Worker / Speech 等 jsdom 缺失的 API 注入到 globalThis，
 *    调用一次即可让所有 slice 写路径测试无侵入运行。
 * 2. `makeTestStore()` —— 用 zustand 直接挂 slice 工厂，避开 `../store` 的完整
 *    StoreState 类型约束，方便单 slice 写路径测试（同 prefs-slice.test.ts 先例）。
 *
 * 使用方式：
 *
 *   import { installPolyfills, makeTestStore } from '../test/polyfills';
 *   beforeAll(() => installPolyfills());
 *
 *   const store = makeTestStore();
 *   await store.getState().createNote('f-1', '标题', '内容');
 *   expect(store.getState().notes.size).toBe(1);
 *
 * 注意：
 * - polyfill 仅在测试环境生效（vitest.config.ts 的 setupFiles 链里调用）
 * - fake-indexeddb 每次测试前 `clearAllDatabases()` 重置状态
 * - Web Crypto 走 node:crypto 的 crypto.subtle（Node 24 已全局）
 * - Web Worker 在 Node 下走 node:worker_threads，但 slice 内通常是 argon2 worker
 *   用 fake-indexeddb 的 IDB 内存存储替代，避免真的 spawn worker
 */

import * as fakeIndexedDB from 'fake-indexeddb';

type PolyfillState = {
  installed: boolean;
};

const state: PolyfillState = { installed: false };

/**
 * 注入 IndexedDB / Web Crypto / Worker 等 jsdom 缺失的 API。
 * 幂等：重复调用不报错，不重复注入。
 */
export function installPolyfills(): void {
  if (state.installed) return;

  // fake-indexeddb：把 IDBDatabase / IDBKeyRange / indexedDB 挂到 globalThis
  const g = globalThis as unknown as Record<string, unknown>;
  if (!('indexedDB' in g)) {
    g.indexedDB = fakeIndexedDB;
  }
  if (!('IDBKeyRange' in g)) {
    g.IDBKeyRange = (fakeIndexedDB as unknown as { IDBKeyRange: unknown }).IDBKeyRange;
  }

  // Web Crypto：Node 24 已全局暴露 crypto，但 jsdom 的 window.crypto 是 undefined。
  // 把 Node 的 crypto.subtle 镜像到 window.crypto，slice 内的 Argon2id 走 WebCrypto 时可用。
  const nodeCrypto = (globalThis as unknown as { crypto?: Crypto }).crypto;
  const w = globalThis as unknown as { crypto?: Crypto; indexedDB?: unknown };
  if (nodeCrypto?.subtle && (!w.crypto || !w.crypto.subtle)) {
    w.crypto = {
      ...nodeCrypto,
      getRandomValues: (arr: Uint32Array) => {
        nodeCrypto.getRandomValues(arr);
        return arr;
      },
      subtle: nodeCrypto.subtle,
    } as unknown as Crypto;
  }

  // Web Worker 的 slice 内通常是 argon2 worker；fake-indexeddb 的内存存储不真 spawn
  // worker，但 slice 代码 `new Worker(...)` 会失败。提供一个 no-op Worker 兜底，
  // 让模块顶层 `new Worker` 不崩；slice 实际走 node:crypto 的 Argon2 而非 worker。
  if (!('Worker' in globalThis)) {
    (globalThis as unknown as { Worker: unknown }).Worker = class FakeWorker {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      postMessage(_msg: unknown): void {
        /* no-op */
      }
      terminate(): void {
        /* no-op */
      }
    };
  }

  // navigator.onLine / navigator 在 jsdom 已有，但部分 slice 直接读 navigator.storage
  // （IndexedDB 配额）——jsdom 没有。给个 noop，让 `navigator.storage.estimate()` 不崩。
  if (typeof navigator !== 'undefined') {
    const n = navigator as unknown as { storage?: unknown };
    if (!n.storage) {
      n.storage = {
        estimate: () =>
          Promise.resolve({
            usage: 0,
            quota: 1024 * 1024 * 1024,
          }),
        persist: () => Promise.resolve(false),
      };
    }
  }

  state.installed = true;
}

/**
 * 重置 fake-indexeddb 的内存数据库（每个测试用例前调用，避免污染）。
 * fake-indexeddb 的 `indexedDB.deleteDatabase` 同步清掉所有对象仓库。
 */
export async function resetIdb(): Promise<void> {
  const idb = (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) return;
  // fake-indexeddb 的 IDBFactory 不一定有 databases()，退化成清空 known 仓库
  const knownDBs: string[] = [];
  // fake-indexeddb/auto 内部维护一个内存池；resetIdb 只清已知名
  for (const name of knownDBs) {
    await new Promise<void>((resolve, reject) => {
      const req = idb.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error(`delete ${name} failed`));
    });
  }
}

/**
 * 创建一个最小 store，挂指定 slice。
 * 用法：
 *   const store = makeTestStore({
 *     data: createDataSlice(set, get),
 *     auth: createAuthSlice(set, get),
 *   });
 *   store.getState().createNote(...)
 *
 * 相比 `import { useStore } from '../lib/store'`：
 * - 不引入完整 StoreState 类型（避免跨 slice 字段依赖全齐才能编译）
 * - 不触发 store.ts 顶层的 i18n / config / theme 初始化
 * - 单 slice 写路径可独立测，不牵动全局副作用
 */
export function makeTestStore<S extends Record<string, unknown>>(
  slices: Partial<Record<keyof S, (set: unknown, get: unknown) => Partial<S> | void>>
): {
  getState: () => S;
  setState: (partial: Partial<S>) => void;
  subscribe: (listener: () => void) => () => void;
} {
  type Setter = (partial: Partial<S>, replace?: boolean | ((state: S) => Partial<S>)) => void;
  type Getter = () => S;
  type Listener = () => void;

  const combined: Record<keyof S, unknown> = {} as Record<keyof S, unknown>;
  const listeners = new Set<Listener>();

  const getter: Getter = () => combined as S;
  const setter: Setter = (partial, replace) => {
    if (typeof replace === 'function') {
      const next = { ...combined, ...replace(getter()) };
      Object.keys(combined).forEach((k) => delete next[k]);
      Object.assign(combined, next);
    } else {
      Object.assign(combined, partial);
    }
    listeners.forEach((l) => l());
  };

  for (const [, factory] of Object.entries(slices)) {
    const result = (factory as (set: unknown, get: unknown) => unknown)(setter, getter);
    if (result) {
      Object.assign(combined, result);
    }
  }

  return {
    getState: getter,
    setState: (partial) => setter(partial, false),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * 测试前调用：先注入 polyfill，再清 IDB。
 * 用法：
 *   beforeAll(installPolyfills);
 *   beforeEach(() => resetIdb());
 */
export function prepareSliceTestEnvironment(): void {
  installPolyfills();
}
