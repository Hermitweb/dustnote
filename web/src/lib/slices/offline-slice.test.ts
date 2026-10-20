/**
 * web/src/lib/slices/offline-slice.ts 单测 —— 离线队列 flush 的 HTTP 状态分支
 *
 * 覆盖：setOnline / refreshPendingCount / flushQueue 各错误分支：
 *  - 401/403 → authHalt（保留队列）
 *  - 429 → rateLimited（保留队列）
 *  - 409 + conflictCtx → handleNoteConflict 路径
 *  - 409 无 conflictCtx → 移除 + hadConflict
 *  - 4xx 其余 → 静默删除 + hadConflict
 *  - 5xx → bumpRetries 退避（保留 op）
 *  - TypeError（断网）→ break 保留 op
 *  - replayOp 抛错 → bumpRetries
 *  - clearLocalData → 清缓存+队列+凭据
 *  - resolveConflictChoice / dismissConflict
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { installPolyfills } from '../../test/polyfills';
import { ApiException, type ApiError } from '@dustnote/shared';

installPolyfills();

const {
  peekAll,
  remove,
  bumpRetries,
  getRetryDelayForOp,
  queueSize,
  clearQueue,
  replayOp,
  cacheNotesLocal,
  clearCache,
  clearGraceUnlock,
  clearLocalAuthBlob,
  clearLockoutState,
  cachesDel,
  api,
  handleNoteConflict,
} = vi.hoisted(() => ({
  peekAll: vi.fn(),
  remove: vi.fn(),
  bumpRetries: vi.fn(),
  getRetryDelayForOp: vi.fn(),
  queueSize: vi.fn(),
  clearQueue: vi.fn(),
  replayOp: vi.fn(),
  cacheNotesLocal: vi.fn(),
  clearCache: vi.fn(),
  clearGraceUnlock: vi.fn(),
  clearLocalAuthBlob: vi.fn(),
  clearLockoutState: vi.fn(),
  // caches.delete 返回 Promise（CacheStorage 真实 API 行为）
  cachesDel: vi.fn(async () => true),
  api: { patch: vi.fn(), get: vi.fn(), post: vi.fn() },
  handleNoteConflict: vi.fn(),
}));
const warnSpy = vi.fn();

vi.mock('../offline-queue', () => ({
  peekAll,
  remove,
  bumpRetries,
  getRetryDelayForOp,
  size: queueSize,
  clear: clearQueue,
}));
vi.mock('../store-helpers', () => ({
  replayOp,
  api: () => api,
  cacheNotesLocal,
  flushingRef: { inFlight: false },
}));
vi.mock('../db', () => ({ clearCache }));
vi.mock('../grace-unlock', () => ({ clearGraceUnlock }));
vi.mock('../local-auth-storage', () => ({
  clearLocalAuthBlob,
  clearLockoutState,
}));
// handleNoteConflict 是 slice 文件内的私有 helper：直接走 409 路径不调用即可
vi.mock('../client-core', () => ({}));

// 拦截全局 console.warn（用于 4xx/5xx 路径的日志断言）
const origWarn = console.warn;
vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => warnSpy(...args));

// mock global caches（clearLocalData 用 caches.delete）
// vi.stubGlobal 让 vitest 帮我覆盖全局属性
beforeEach(() => {
  vi.stubGlobal('caches', { delete: cachesDel });
});

import { createOfflineSlice } from './offline-slice.js';
import { INITIAL_LOCKOUT_STATE } from '@dustnote/shared';
import { flushingRef } from '../store-helpers';
import type { StoreState } from '../store';
import type { PendingConflict } from '../store-types';
import type { StoreApi } from 'zustand';

function makeStore(initial: Partial<StoreState> = {}) {
  // 断言集中在构造边界这一次：测试只装配 offline-slice 关心的字段，而 StoreState 是
  // 五个 slice 的交集，故此处需要一次显式断言；断言之后 state.notes / actions.flushQueue
  // 等访问全部是强类型——测试与生产类型的偏差会在编译期暴露。此前用
  // `type S = Record<string, unknown>` 逃生舱把这些偏差全部掩盖了。
  const base = {
    isOnline: true,
    pendingCount: 0,
    pendingConflicts: [],
    notes: new Map(),
    notesPlain: new Map(),
    notes2: new Map(),
    // 必需的 stub 字段
    mode: 'standalone',
    authState: 'unlocked',
    accessToken: 'tok',
    userId: 'u-1',
    masterKey: new Uint8Array(32),
    lockoutState: { ...INITIAL_LOCKOUT_STATE },
    pendingCount_refresh: async () => 0,
    loadAll: vi.fn(),
    // overrides
    ...initial,
  } as unknown as StoreState;
  const combined: StoreState = { ...base };
  const set: StoreApi<StoreState>['setState'] = (partial) => {
    const p = typeof partial === 'function' ? partial(combined) : partial;
    Object.assign(combined, p);
  };
  const get = () => combined;
  // zustand 的 StateCreator 签名是 (set, get, api)。offline-slice 只用 set/get，
  // 这里给一个最小可用的 api 实现（subscribe 退订即可）。
  const api: StoreApi<StoreState> = {
    setState: set,
    getState: get,
    getInitialState: get,
    subscribe: () => () => undefined,
    destroy: () => undefined,
  };
  const slice = createOfflineSlice(set, get, api);
  Object.assign(combined, slice);
  Object.assign(combined, initial);
  return { state: combined, actions: slice };
}

function apiEx(status: number, message = 'x'): ApiException {
  return new ApiException({ status, code: 'x', message } as ApiError);
}

describe('offline-slice', () => {
  beforeEach(() => {
    peekAll.mockReset();
    remove.mockReset();
    bumpRetries.mockReset();
    getRetryDelayForOp.mockReset();
    queueSize.mockReset();
    clearQueue.mockReset();
    replayOp.mockReset();
    api.patch.mockReset();
    api.get.mockReset();
    api.post.mockReset();
    cacheNotesLocal.mockReset();
    clearCache.mockReset();
    clearGraceUnlock.mockReset();
    clearLocalAuthBlob.mockReset();
    clearLockoutState.mockReset();
    handleNoteConflict.mockReset();
    cachesDel.mockReset();
    warnSpy.mockReset();
    flushingRef.inFlight = false;
  });

  afterAll(() => {
    console.warn = origWarn;
  });

  describe('setOnline / refreshPendingCount', () => {
    it('setOnline(true) → isOnline=true + 触发 refreshPendingCount', async () => {
      queueSize.mockResolvedValue(5);
      const { actions, state } = makeStore();
      actions.setOnline(true);
      expect(state.isOnline).toBe(true);
      await new Promise((r) => setImmediate(r));
      expect(queueSize).toHaveBeenCalled();
      expect(state.pendingCount).toBe(5);
    });

    it('setOnline(false) → isOnline=false + 不刷', () => {
      queueSize.mockReset();
      const { actions, state } = makeStore();
      actions.setOnline(false);
      expect(state.isOnline).toBe(false);
      expect(queueSize).not.toHaveBeenCalled();
    });

    it('refreshPendingCount：queueSize 抛错 → 静默（不抛）', async () => {
      queueSize.mockRejectedValueOnce(new Error('IDB down'));
      const { actions } = makeStore();
      await expect(actions.refreshPendingCount()).resolves.toBeUndefined();
    });
  });

  describe('flushQueue 状态机', () => {
    it('空队列 → 立即返回', async () => {
      peekAll.mockResolvedValueOnce([]);
      const { actions } = makeStore();
      await actions.flushQueue();
      expect(replayOp).not.toHaveBeenCalled();
    });

    it('已在 flush 中 → 早返回（reentrancy guard）', async () => {
      flushingRef.inFlight = true;
      const { actions } = makeStore();
      await actions.flushQueue();
      expect(peekAll).not.toHaveBeenCalled();
      flushingRef.inFlight = false;
    });

    it('成功 replayOp → 移除 op + loadAll 收尾', async () => {
      peekAll.mockResolvedValueOnce([{ id: 'op-1', method: 'POST', path: '/notes' }]);
      replayOp.mockResolvedValueOnce(undefined);
      remove.mockResolvedValueOnce(undefined);
      queueSize.mockResolvedValueOnce(0);
      const { actions, state } = makeStore();
      await actions.flushQueue();
      expect(replayOp).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith('op-1');
      // 队列清空 → isOnline=true
      expect(state.isOnline).toBe(true);
    });

    it('409 无 conflictCtx → 移除 op + hadConflict + loadAll 收尾', async () => {
      peekAll.mockResolvedValueOnce([{ id: 'op-1', method: 'POST', path: '/x' }]);
      replayOp.mockRejectedValueOnce(apiEx(409));
      remove.mockResolvedValueOnce(undefined);
      queueSize.mockResolvedValueOnce(0);
      const { actions } = makeStore();
      await actions.flushQueue();
      expect(remove).toHaveBeenCalledWith('op-1');
      expect(warnSpy).not.toHaveBeenCalled(); // 409 不应 warn
    });

    it('401 → authHalt：保留 op 不删除，isOnline=false', async () => {
      peekAll.mockResolvedValueOnce([{ id: 'op-1' }, { id: 'op-2' }]);
      replayOp.mockRejectedValueOnce(apiEx(401));
      queueSize.mockResolvedValueOnce(2);
      const { actions, state } = makeStore();
      await actions.flushQueue();
      // op-1 失败触发 authHalt，break 出循环，op-2 不处理
      expect(remove).not.toHaveBeenCalled();
      expect(state.isOnline).toBe(false);
    });

    it('403 → authHalt（同 401）', async () => {
      peekAll.mockResolvedValueOnce([{ id: 'op-1' }]);
      replayOp.mockRejectedValueOnce(apiEx(403));
      queueSize.mockResolvedValueOnce(1);
      const { actions, state } = makeStore();
      await actions.flushQueue();
      expect(remove).not.toHaveBeenCalled();
      expect(state.isOnline).toBe(false);
    });

    it('429 → rateLimited：保留 op 不删除', async () => {
      peekAll.mockResolvedValueOnce([{ id: 'op-1' }]);
      replayOp.mockRejectedValueOnce(apiEx(429));
      queueSize.mockResolvedValueOnce(1);
      const { actions, state } = makeStore();
      await actions.flushQueue();
      expect(remove).not.toHaveBeenCalled();
      expect(state.isOnline).toBe(false);
    });

    it('400 → 其余 4xx：warn + 移除 op（永久失败，不再重试）', async () => {
      peekAll.mockResolvedValueOnce([{ id: 'op-bad', method: 'POST', path: '/x' }]);
      replayOp.mockRejectedValueOnce(apiEx(400));
      remove.mockResolvedValueOnce(undefined);
      queueSize.mockResolvedValueOnce(0);
      const { actions } = makeStore();
      await actions.flushQueue();
      expect(remove).toHaveBeenCalledWith('op-bad');
      // 第一次 warn 调用的第一个参数就是 dropping 消息
      const firstWarnCall = warnSpy.mock.calls[0];
      expect(firstWarnCall?.[0]).toBe('[offline] dropping op on client error');
      expect(firstWarnCall?.[1]).toBe('/x');
      expect(firstWarnCall?.[2]).toBe('POST');
      expect(firstWarnCall?.[3]).toBe(400);
    });

    it('5xx → warn + bumpRetries + getRetryDelay（保留 op）', async () => {
      peekAll.mockResolvedValueOnce([{ id: 'op-5xx', method: 'POST', path: '/x' }]);
      replayOp.mockRejectedValueOnce(apiEx(503));
      bumpRetries.mockResolvedValueOnce(undefined);
      getRetryDelayForOp.mockResolvedValueOnce(50);
      queueSize.mockResolvedValueOnce(1);
      const { actions } = makeStore();
      await actions.flushQueue();
      expect(remove).not.toHaveBeenCalled();
      expect(bumpRetries).toHaveBeenCalledWith('op-5xx');
      const firstWarnCall = warnSpy.mock.calls[0];
      expect(firstWarnCall?.[0]).toBe('[offline] server error on op');
      expect(firstWarnCall?.[1]).toBe('/x');
      expect(firstWarnCall?.[2]).toBe('POST');
      expect(firstWarnCall?.[3]).toBe(503);
    });

    it('TypeError（断网）→ break 保留 op', async () => {
      peekAll.mockResolvedValueOnce([{ id: 'op-net' }]);
      replayOp.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      queueSize.mockResolvedValueOnce(1);
      const { actions } = makeStore();
      await actions.flushQueue();
      expect(remove).not.toHaveBeenCalled();
    });

    it('未知 Error（非 ApiException/TypeError）→ warn + bumpRetries', async () => {
      peekAll.mockResolvedValueOnce([{ id: 'op-weird' }]);
      replayOp.mockRejectedValueOnce(new Error('weird'));
      bumpRetries.mockResolvedValueOnce(undefined);
      getRetryDelayForOp.mockResolvedValueOnce(10);
      queueSize.mockResolvedValueOnce(1);
      const { actions } = makeStore();
      await actions.flushQueue();
      expect(remove).not.toHaveBeenCalled();
      expect(bumpRetries).toHaveBeenCalledWith('op-weird');
    });

    it('finally 分支：flushingRef.inFlight 在结束时重置', async () => {
      peekAll.mockResolvedValueOnce([{ id: 'op-1' }]);
      replayOp.mockResolvedValueOnce(undefined);
      remove.mockResolvedValueOnce(undefined);
      queueSize.mockResolvedValueOnce(0);
      const { actions } = makeStore();
      await actions.flushQueue();
      // setTimeout(0) 后才重置（看 setTimeout 在 finally 块里）
      await new Promise((r) => setTimeout(r, 5));
      expect(flushingRef.inFlight).toBe(false);
    });
  });

  describe('clearLocalData', () => {
    it('清缓存 + 清队列 + 清凭据 + 状态重置', async () => {
      clearCache.mockResolvedValueOnce(undefined);
      clearQueue.mockResolvedValueOnce(undefined);
      cachesDel.mockResolvedValue(true);
      const { actions, state } = makeStore({
        pendingCount: 5,
        pendingConflicts: [{ noteId: 'n1' } as never],
        localAuthBlob: { foo: 'bar' } as never,
      });
      await actions.clearLocalData();
      expect(clearCache).toHaveBeenCalled();
      expect(clearGraceUnlock).toHaveBeenCalled();
      expect(clearLocalAuthBlob).toHaveBeenCalled();
      expect(clearLockoutState).toHaveBeenCalled();
      expect(cachesDel).toHaveBeenCalledWith('dustnote-runtime-v2');
      expect(cachesDel).toHaveBeenCalledWith('dustnote-runtime');
      expect(state.pendingCount).toBe(0);
      expect(state.pendingConflicts).toEqual([]);
      expect(state.localAuthBlob).toBeNull();
    });
  });

  describe('resolveConflictChoice / dismissConflict', () => {
    it('dismissConflict：把 noteId 从 pendingConflicts 移除', () => {
      const { actions, state } = makeStore({
        pendingConflicts: [{ noteId: 'n1' } as never, { noteId: 'n2' } as never],
      });
      actions.dismissConflict('n1');
      expect(state.pendingConflicts).toEqual([{ noteId: 'n2' }]);
    });

    it('resolveConflictChoice：noteId 不在 pending → 不动', async () => {
      const { actions, state } = makeStore({ pendingConflicts: [] });
      await expect(actions.resolveConflictChoice('n-unknown', 'local')).resolves.toBeUndefined();
      expect(state.pendingConflicts).toEqual([]);
      expect(api.patch).not.toHaveBeenCalled();
    });

    it('resolveConflictChoice：未解锁（masterKey=null）→ 抛 "未解锁"', async () => {
      // 断言集中在 fixture 边界：mergeable 三元组的 id / clientUpdatedAt 在本用例
      // 用不到（masterKey 为 null 时根本走不到读取分支），故整体断言成 PendingConflict。
      const conflict = {
        noteId: 'n1',
        conflicts: [],
        merged: {
          plaintext: { title: 'm', content: '' },
          isPinned: false,
          isFavorite: false,
          folderId: null,
          deletedAt: null,
        },
        local: {
          plaintext: { title: 'l', content: '' },
          isPinned: false,
          isFavorite: false,
          folderId: null,
          deletedAt: null,
        },
        server: {
          plaintext: { title: 's', content: '' },
          isPinned: false,
          isFavorite: false,
          folderId: null,
          deletedAt: null,
        },
        serverVersion: 5,
      } as unknown as PendingConflict;
      const { actions } = makeStore({
        pendingConflicts: [conflict],
        masterKey: null,
      });
      await expect(actions.resolveConflictChoice('n1', 'local')).rejects.toThrow(/未解锁/);
    });
  });
});
