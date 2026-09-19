/**
 * 冲突裁决 store 与模式 store 测试（审计 ARCH-002 后续项）
 *
 * 锁住下沉后的行为契约，特别是：
 * - 冲突只存内存、绝不落盘（mobile 曾把含笔记明文的 conflicts 写进
 *   未加密的 AsyncStorage，与 E2EE「明文不落盘」冲突）
 * - 模式 store 的持久化时机与平台钩子（URL 同步 / 重置前置标记）
 */
import { describe, expect, it, vi } from 'vitest';
import { createConflictStore } from '../src/conflict-store.js';
import { createModeStore, DEFAULT_MODE_STATE, MODE_STORAGE_KEY } from '../src/mode-store.js';
import type { PendingConflict } from '../src/conflict-store.js';
import type { AppMode, ModeState } from '@dustnote/shared';

const CONFLICT: PendingConflict = {
  noteId: 'n1',
  title: '标题',
  conflicts: [{ field: 'title', localValue: 'a', serverValue: 'b' } as never],
  merged: {
    plaintext: { title: 'merged' },
    isPinned: false,
    isFavorite: false,
    folderId: null,
    deletedAt: null,
  } as never,
  local: {
    plaintext: { title: 'local' },
    isPinned: true,
    isFavorite: false,
    folderId: null,
    deletedAt: null,
  } as never,
  server: {
    plaintext: { title: 'server' },
    isPinned: false,
    isFavorite: true,
    folderId: null,
    deletedAt: null,
  } as never,
  serverVersion: 7,
};

describe('createConflictStore', () => {
  function makeStore(over: { masterKey?: Uint8Array | null } = {}) {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    // 注意用 in 判断：masterKey: null 时不能用 ?? 兜底（null ?? x === x）
    const masterKey = 'masterKey' in over ? (over.masterKey ?? null) : new Uint8Array(32);
    const store = createConflictStore({
      getApi: () =>
        ({
          request: async (method: string, path: string, body: unknown) => {
            requests.push({ method, path, body });
            return {};
          },
        }) as never,
      getAuth: () => ({ masterKey, userId: 'u1' }),
    });
    return { store, requests };
  }

  it('入队去重：同一笔记只保留最新一条', () => {
    const { store } = makeStore();
    store.getState().enqueueConflict(CONFLICT);
    store.getState().enqueueConflict({ ...CONFLICT, title: '新标题' });
    expect(store.getState().pendingConflicts).toHaveLength(1);
    expect(store.getState().pendingConflicts[0]?.title).toBe('新标题');
  });

  it('选择 local：加密后以 serverVersion 为乐观锁 re-PATCH，并移除 pending', async () => {
    const { store, requests } = makeStore();
    store.getState().enqueueConflict(CONFLICT);
    await store.getState().resolveConflictChoice('n1', 'local');

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('PATCH');
    expect(requests[0]?.path).toBe('/notes/n1');
    const body = requests[0]?.body as { version: number; ciphertext: string; isPinned: boolean };
    expect(body.version).toBe(7);
    expect(body.ciphertext.length).toBeGreaterThan(0);
    expect(body.isPinned).toBe(true); // local 版本
    expect(store.getState().pendingConflicts).toHaveLength(0);
  });

  it('未解锁时抛错且保留 pending（用户可稍后重试）', async () => {
    const { store, requests } = makeStore({ masterKey: null });
    store.getState().enqueueConflict(CONFLICT);
    await expect(store.getState().resolveConflictChoice('n1', 'local')).rejects.toThrow('未解锁');
    expect(requests).toHaveLength(0);
    expect(store.getState().pendingConflicts).toHaveLength(1);
  });

  it('dismiss 仅移除不联网', () => {
    const { store, requests } = makeStore();
    store.getState().enqueueConflict(CONFLICT);
    store.getState().dismissConflict('n1');
    expect(store.getState().pendingConflicts).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it('re-PATCH 失败时 pending 保留（不清空，可重试）', async () => {
    const store = createConflictStore({
      getApi: () =>
        ({
          request: async () => {
            throw new Error('network');
          },
        }) as never,
      getAuth: () => ({ masterKey: new Uint8Array(32), userId: 'u1' }),
    });
    store.getState().enqueueConflict(CONFLICT);
    await expect(store.getState().resolveConflictChoice('n1', 'server')).rejects.toThrow('network');
    expect(store.getState().pendingConflicts).toHaveLength(1);
  });
});

describe('createModeStore', () => {
  function makeStore(opts: { initial?: Partial<ModeState>; hooks?: boolean } = {}) {
    let saved: ModeState | null = null;
    const onServerUrlChange = vi.fn();
    const onBeforeReset = vi.fn();
    const store = createModeStore({
      load: () => opts.initial ?? null,
      save: (s) => {
        saved = s;
      },
      ...(opts.hooks ? { onServerUrlChange, onBeforeReset } : {}),
    });
    return { store, onServerUrlChange, onBeforeReset, savedState: () => saved };
  }

  it('默认状态为单机 + 未初始化；storage key 稳定', () => {
    const { store } = makeStore();
    expect(MODE_STORAGE_KEY).toBe('dustnote_mode_state');
    expect(store.getState().mode).toBe(DEFAULT_MODE_STATE.mode);
    expect(store.getState().initialized).toBe(false);
    expect(store.getState().hydrated).toBe(true);
  });

  it('load 到的持久化状态覆盖默认值', () => {
    const { store } = makeStore({
      initial: { mode: 'online', serverUrl: 'http://x:3210', initialized: true },
    });
    expect(store.getState().mode).toBe('online');
    expect(store.getState().serverUrl).toBe('http://x:3210');
    expect(store.getState().initialized).toBe(true);
  });

  it('setMode/setServerUrl/initialize 都落盘；地址变化触发平台钩子', () => {
    const { store, onServerUrlChange, savedState } = makeStore({ hooks: true });
    store.getState().setMode('online');
    expect(savedState()?.mode).toBe('online');

    store.getState().setServerUrl('http://srv:8080');
    expect(onServerUrlChange).toHaveBeenCalledWith('http://srv:8080');
    expect(savedState()?.serverUrl).toBe('http://srv:8080');

    store.getState().initialize();
    expect(savedState()?.initialized).toBe(true);
    // initialize 时已处于 online + 有地址 → 再次同步 URL（刷新后书签仍带 server）
    expect(onServerUrlChange).toHaveBeenLastCalledWith('http://srv:8080');
  });

  it('resetMode 先调平台前置钩子（web 打「首访默认已应用」标记）再复位', () => {
    const { store, onBeforeReset, savedState } = makeStore({
      initial: { mode: 'online', serverUrl: 'http://x', initialized: true },
      hooks: true,
    });
    store.getState().resetMode();
    expect(onBeforeReset).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject(DEFAULT_MODE_STATE);
    expect(savedState()).toEqual(DEFAULT_MODE_STATE);
  });

  it('startsUnhydrated：起步 hydrated=false，applyHydrated 后置 true 且不回写存储', () => {
    let saveCount = 0;
    const store = createModeStore({
      load: () => null,
      save: () => {
        saveCount += 1;
      },
      startsUnhydrated: true,
    });
    expect(store.getState().hydrated).toBe(false);
    store.getState().applyHydrated({ mode: 'online', serverUrl: 'http://y', initialized: true });
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().mode).toBe('online');
    expect(saveCount).toBe(0); // hydrate 是只读语义
  });

  it('applyHydrated 对缺失字段用默认值兜底（旧版本残留状态）', () => {
    const store = createModeStore({
      load: () => null,
      save: () => undefined,
      startsUnhydrated: true,
    });
    store
      .getState()
      .applyHydrated({ mode: 'online', serverUrl: null, initialized: undefined as never });
    expect(store.getState().mode).toBe('online');
    expect(store.getState().initialized).toBe(false);
  });
});

describe('AppMode 类型约束（编译期）', () => {
  it('setMode 只接受受支持模式', () => {
    const store = createModeStore({ load: () => null, save: () => undefined });
    const m: AppMode = 'standalone';
    store.getState().setMode(m);
    expect(store.getState().mode).toBe('standalone');
  });
});
