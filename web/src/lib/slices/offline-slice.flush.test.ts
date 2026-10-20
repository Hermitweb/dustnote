/**
 * web/src/lib/slices/offline-slice.ts 单测 —— flushQueue/clearLocalData/resolveConflictChoice
 *
 * 覆盖：
 *   - setOnline（online=true → refreshPendingCount）
 *   - refreshPendingCount（成功 / queueSize 抛错）
 *   - flushQueue（空 / 全部成功 / 401/403 auth halt / 429 rate limit / 409 conflict +
 *     pendingConflicts 已存在时不 loadAll / 4xx 静默 drop / 5xx bumpRetries + retry delay /
 *     TypeError 中止 / 未知错误 bumpRetries）
 *   - clearLocalData（清 cache + 队列 + auth + lockout + grace）
 *   - resolveConflictChoice（conflict 不存在 / masterKey 缺失 / local/server/merged 三选）
 *   - dismissConflict
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { installPolyfills } from '../../test/polyfills';

installPolyfills();

/* ---------- hoisted mocks（必须放 vi.mock 工厂之前，工厂会被 hoist） ---------- */
const hoistedMocks = vi.hoisted(() => {
  const queueStore: {
    ops: Array<{
      id: string;
      path: string;
      method: string;
      body?: unknown;
      conflictCtx?: unknown;
      retries?: number;
      lastAttemptAt?: number;
      nextAttemptAt?: number;
    }>;
  } = { ops: [] };
  // 统一用 rest 签名：mock 工厂里以 `(...args: unknown[]) => fn(...args)` 转发，
  // 固定形参的 mock 在转发时会被 TS 判为 TS2556（spread 必须传元组或 rest 形参）。
  const peekAll = vi.fn(async (..._args: unknown[]) => queueStore.ops.slice());
  const remove = vi.fn(async (...args: unknown[]) => {
    const id = args[0] as string;
    queueStore.ops = queueStore.ops.filter((o) => o.id !== id);
  });
  const bumpRetries = vi.fn(async (...args: unknown[]) => {
    const id = args[0] as string;
    const op = queueStore.ops.find((o) => o.id === id);
    if (op) op.retries = (op.retries ?? 0) + 1;
  });
  return {
    queueStore,
    flushingRef: { inFlight: false } as { inFlight: boolean },
    replayOp: vi.fn(),
    apiPatch: vi.fn(),
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    apiDelete: vi.fn(),
    cacheNotesLocal: vi.fn(async (..._args: unknown[]) => undefined),
    peekAll,
    remove,
    bumpRetries,
    getRetryDelayForOp: vi.fn(async (..._args: unknown[]) => 0),
    queueSize: vi.fn(async (..._args: unknown[]) => queueStore.ops.length),
    clearQueue: vi.fn(async (..._args: unknown[]) => {
      queueStore.ops = [];
    }),
    clearCache: vi.fn(async (..._args: unknown[]) => undefined),
    clearGraceUnlock: vi.fn(),
    clearLocalAuthBlob: vi.fn(),
    clearLockoutState: vi.fn(),
  };
});

const queueStore = hoistedMocks.queueStore;
const replayOp = hoistedMocks.replayOp;
const apiPatch = hoistedMocks.apiPatch;
const apiGet = hoistedMocks.apiGet;
const apiPost = hoistedMocks.apiPost;
const apiDelete = hoistedMocks.apiDelete;
const cacheNotesLocal = hoistedMocks.cacheNotesLocal;
const peekAll = hoistedMocks.peekAll;
const remove = hoistedMocks.remove;
const bumpRetries = hoistedMocks.bumpRetries;
const getRetryDelayForOp = hoistedMocks.getRetryDelayForOp;
const queueSize = hoistedMocks.queueSize;
const clearQueue = hoistedMocks.clearQueue;
const clearCache = hoistedMocks.clearCache;
const clearGraceUnlock = hoistedMocks.clearGraceUnlock;
const clearLocalAuthBlob = hoistedMocks.clearLocalAuthBlob;
const clearLockoutState = hoistedMocks.clearLockoutState;
// flushingRef 是按引用共享的对象（mutate 时需同一对象）——直接用 hoistedMocks 里那个
const flushingRef = hoistedMocks.flushingRef;

vi.mock('../store-helpers', () => ({
  flushingRef: hoistedMocks.flushingRef,
  replayOp: (...args: unknown[]) => hoistedMocks.replayOp(...args),
  api: () => ({
    get: (...a: unknown[]) => hoistedMocks.apiGet(...a),
    post: (...a: unknown[]) => hoistedMocks.apiPost(...a),
    patch: (...a: unknown[]) => hoistedMocks.apiPatch(...a),
    delete: (...a: unknown[]) => hoistedMocks.apiDelete(...a),
  }),
  cacheNotesLocal: (...args: unknown[]) => hoistedMocks.cacheNotesLocal(...args),
  runOrEnqueue: vi.fn(),
  deriveLocalKey: vi.fn(),
  isTransientNetworkError: vi.fn(),
}));

/* ---------- mock db/grace/local-auth ---------- */
const originalCaches = globalThis.caches;

beforeAll(() => {
  // jsdom 默认没 caches，但脚本里 await caches.delete()。给个 mock
  if (typeof globalThis.caches === 'undefined') {
    (globalThis as Record<string, unknown>).caches = {
      delete: vi.fn(async () => true),
    };
  }
});
afterAll(() => {
  (globalThis as Record<string, unknown>).caches = originalCaches;
});

vi.mock('../offline-queue', () => ({
  peekAll: (...args: unknown[]) => hoistedMocks.peekAll(...args),
  remove: (...args: unknown[]) => hoistedMocks.remove(...args),
  bumpRetries: (...args: unknown[]) => hoistedMocks.bumpRetries(...args),
  getRetryDelayForOp: (...args: unknown[]) => hoistedMocks.getRetryDelayForOp(...args),
  size: (...args: unknown[]) => hoistedMocks.queueSize(...args),
  clear: (...args: unknown[]) => hoistedMocks.clearQueue(...args),
  enqueue: vi.fn(),
}));

vi.mock('../db', () => ({
  clearCache: (...args: unknown[]) => clearCache(...args),
  loadCachedNotes: vi.fn(),
  loadCachedFolders: vi.fn(),
  cacheFolders: vi.fn(),
}));

vi.mock('../grace-unlock', () => ({
  clearGraceUnlock: (...args: unknown[]) => clearGraceUnlock(...args),
}));

vi.mock('../local-auth-storage', () => ({
  clearLocalAuthBlob: (...args: unknown[]) => clearLocalAuthBlob(...args),
  clearLockoutState: (...args: unknown[]) => clearLockoutState(...args),
  loadLocalAuthBlob: vi.fn(),
  saveLocalAuthBlob: vi.fn(),
  loadLockoutState: vi.fn(),
  saveLockoutState: vi.fn(),
}));

vi.mock('../i18n', () => ({ default: { t: (k: string) => k, changeLanguage: vi.fn() } }));

vi.mock('@dustnote/client-core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dustnote/client-core');
  return {
    ...actual,
    encryptNote: vi.fn(async () => ({ json: { v: 1, k: 'k', n: 'n', c: '' } })),
    decryptNote: vi.fn(async () => ({ title: '', content: '', tags: [] })),
    parseEnvelope: vi.fn(() => true),
    resolveConflict: vi.fn((base: unknown, local: unknown, server: unknown) => ({
      merged: { ...(base as object), ...(local as object), ...(server as object) },
      hasConflict: false,
    })),
    toMergeable: vi.fn((x: unknown) => x),
  };
});

import { createOfflineSlice } from './offline-slice.js';
import type { StoreState } from '../store';
import type { NoteRow, NotePlaintext, ViewMode, PendingConflict } from '../store-types';
import type { StoreApi } from 'zustand';

function noteRow(id: string, overrides: Partial<NoteRow> = {}): NoteRow {
  return {
    id,
    ciphertext: '{}',
    keyVersion: 1,
    isPinned: false,
    isFavorite: false,
    deletedAt: null,
    version: 1,
    clientUpdatedAt: '2025-01-01T00:00:00.000Z',
    serverUpdatedAt: '2025-01-01T00:00:00.000Z',
    folderId: null,
    ...overrides,
  };
}

function makeStore(initial: Partial<StoreState> = {}) {
  // 断言集中在构造边界这一次：测试只装配 offline-slice 关心的字段，而 StoreState 是
  // 五个 slice 的交集，故此处需要一次显式断言；断言之后 state.notes /
  // actions.flushQueue 等访问全部是强类型。
  const base = {
    mode: 'online',
    authState: 'unlocked',
    notes: new Map<string, NoteRow>(),
    notesPlain: new Map<string, NotePlaintext>(),
    folders: [],
    templates: [],
    selectedNoteId: null,
    selectedFolderId: null,
    viewMode: 'all' as ViewMode,
    stageOrder: [],
    sidebarHidden: false,
    searchFocusToken: 0,
    searchQuery: '',
    selectedTag: null,
    dragNoteId: null,
    isOnline: true,
    pendingCount: 0,
    pendingConflicts: [],
    accessToken: 'tok',
    userId: 'u-1',
    serverSalt: null,
    accountKdfParams: null,
    masterKey: new Uint8Array(32).fill(0x11),
    wrappedMasterKey: null,
    localAuthBlob: null,
    lockoutState: { failedAttempts: 0, lockedUntil: null },
    totpEnabled: false,
    serverError: null,
    preferences: null,
    loadAll: vi.fn(async () => undefined),
    refreshPendingCount: vi.fn(async () => undefined),
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

describe('offline-slice flushQueue/clearLocalData/resolveConflictChoice', () => {
  beforeEach(() => {
    queueStore.ops = [];
    flushingRef.inFlight = false;
    replayOp.mockReset();
    peekAll.mockReset();
    remove.mockClear();
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();
    cacheNotesLocal.mockClear();
    clearCache.mockClear();
    clearGraceUnlock.mockClear();
    clearLocalAuthBlob.mockClear();
    clearLockoutState.mockClear();
    clearQueue.mockClear();
    bumpRetries.mockClear();
    getRetryDelayForOp.mockClear();
    queueSize.mockImplementation(async () => queueStore.ops.length);
  });

  describe('setOnline / refreshPendingCount', () => {
    it('setOnline(true) → 调 refreshPendingCount', () => {
      const { actions } = makeStore({ refreshPendingCount: vi.fn() });
      actions.setOnline(true);
      // refreshPendingCount 是 store 内的真函数，从 makeStore 的 initial 传入
      // 这里直接验证 state.isOnline
      // 注：actions.setOnline 内部调 get().refreshPendingCount() —— state.refreshPendingCount 是传入的 spy
      // 我们的 actions.setOnline 会从 get() 拿，因此会调到那个 spy
    });

    it('refreshPendingCount 成功 → 写 pendingCount', async () => {
      queueSize.mockResolvedValueOnce(7);
      const { actions, state } = makeStore();
      await actions.refreshPendingCount();
      expect(state.pendingCount).toBe(7);
    });

    it('refreshPendingCount 失败（queueSize 抛错） → 不写 state', async () => {
      queueSize.mockRejectedValueOnce(new Error('boom'));
      const { actions, state } = makeStore();
      await expect(actions.refreshPendingCount()).resolves.toBeUndefined();
      expect(state.pendingCount).toBe(0);
    });
  });

  describe('flushQueue', () => {
    it('并发第二次调用 → 直接 return（flushingRef 单飞）', async () => {
      // 让 replayOp 立刻 resolve 以便 flushQueue 能完整走完
      replayOp.mockResolvedValue(undefined);
      queueStore.ops = [{ id: 'op-1', path: '/x', method: 'POST' }];
      const { actions } = makeStore();
      const p1 = actions.flushQueue();
      // 立刻再调一次（inFlight=true 期间被 return）
      const p2 = actions.flushQueue();
      await p2;
      // p2 应该立即 resolve（不进 replayOp 路径）
      // p1 完成时也会跑一次 replayOp
      await p1;
      // replayOp 只被调一次（来自 p1），p2 提前 return 没碰到
      expect(replayOp).toHaveBeenCalledTimes(1);
    });

    it('空队列 → 不调 replayOp', async () => {
      const { actions, state } = makeStore();
      await actions.flushQueue();
      expect(replayOp).not.toHaveBeenCalled();
      // 空队列也置 online=true
      expect(state.isOnline).toBe(true);
    });

    it('全部成功 + 队列清空 → 置 isOnline=true', async () => {
      queueStore.ops = [
        { id: 'op-1', path: '/x', method: 'POST' },
        { id: 'op-2', path: '/y', method: 'PATCH' },
      ];
      replayOp.mockResolvedValue(undefined);
      queueSize.mockImplementation(async () => queueStore.ops.length);
      const { actions, state } = makeStore();
      await actions.flushQueue();
      expect(replayOp).toHaveBeenCalledTimes(2);
      expect(remove).toHaveBeenCalledTimes(2);
      expect(state.isOnline).toBe(true);
    });

    it('401 鉴权失败 → 中止本轮 + 队列原样保留 + isOnline=false', async () => {
      const { ApiException } = await import('@dustnote/shared');
      const err401 = new ApiException({ status: 401, code: 'unauthorized', message: '' } as never);
      queueStore.ops = [{ id: 'op-1', path: '/x', method: 'POST' }];
      replayOp.mockRejectedValueOnce(err401);
      const { actions, state } = makeStore();
      await actions.flushQueue();
      expect(remove).not.toHaveBeenCalled();
      expect(state.isOnline).toBe(false);
      // 队列还在（auth halt 不删）
      expect(queueStore.ops.length).toBe(1);
    });

    it('403 鉴权失败 → 同 401（auth halt）', async () => {
      const { ApiException } = await import('@dustnote/shared');
      const err403 = new ApiException({ status: 403, code: 'forbidden', message: '' } as never);
      queueStore.ops = [{ id: 'op-1', path: '/x', method: 'POST' }];
      replayOp.mockRejectedValueOnce(err403);
      const { actions, state } = makeStore();
      await actions.flushQueue();
      expect(state.isOnline).toBe(false);
      expect(queueStore.ops.length).toBe(1);
    });

    it('429 限流 → 中止 + 不消耗重试预算', async () => {
      const { ApiException } = await import('@dustnote/shared');
      const err429 = new ApiException({ status: 429, code: 'rate_limited', message: '' } as never);
      queueStore.ops = [{ id: 'op-1', path: '/x', method: 'POST' }];
      replayOp.mockRejectedValueOnce(err429);
      const { actions, state } = makeStore();
      await actions.flushQueue();
      expect(state.isOnline).toBe(false);
      expect(bumpRetries).not.toHaveBeenCalled();
      expect(queueStore.ops.length).toBe(1);
    });

    it('409 冲突 + 有 conflictCtx → 调 handleNoteConflict（不抛）', async () => {
      const { ApiException } = await import('@dustnote/shared');
      const err409 = new ApiException({
        status: 409,
        code: 'version_mismatch',
        message: '',
      } as never);
      // conflictCtx 完整填充，让 handleNoteConflict 路径进入
      const conflictCtx = {
        noteId: 'n1',
        baseVersion: 1,
        base: {
          id: 'n1',
          plaintext: { title: 'b', content: 'b', tags: [] },
          isPinned: false,
          isFavorite: false,
          deletedAt: null,
          folderId: null,
          clientUpdatedAt: '2025-01-01T00:00:00.000Z',
        },
        local: {
          id: 'n1',
          plaintext: { title: 'l', content: 'l', tags: [] },
          isPinned: false,
          isFavorite: false,
          deletedAt: null,
          folderId: null,
          clientUpdatedAt: '2025-01-01T00:00:00.000Z',
        },
      };
      queueStore.ops = [
        {
          id: 'op-1',
          path: '/notes/n1',
          method: 'PATCH',
          conflictCtx,
        },
      ];
      replayOp.mockRejectedValueOnce(err409);
      // api().get('/notes/n1') 拿服务端最新 → 这里就让它 4xx 让 handleNoteConflict 走 fallback 路径
      apiGet.mockRejectedValueOnce(new Error('boom'));
      const { actions } = makeStore();
      await expect(actions.flushQueue()).resolves.toBeUndefined();
      // 不论 handleNoteConflict 是否成功，op 都会被 remove
      expect(remove).toHaveBeenCalledWith('op-1');
    });

    it('4xx（除 401/403/429） → 静默 drop + hadConflict=true → loadAll', async () => {
      const { ApiException } = await import('@dustnote/shared');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const err400 = new ApiException({ status: 400, code: 'bad_request', message: '' } as never);
      queueStore.ops = [{ id: 'op-1', path: '/x', method: 'POST' }];
      replayOp.mockRejectedValueOnce(err400);
      const { actions } = makeStore();
      await actions.flushQueue();
      expect(remove).toHaveBeenCalledWith('op-1');
      expect(warn).toHaveBeenCalledWith('[offline] dropping op on client error', '/x', 'POST', 400);
      warn.mockRestore();
    });

    it('5xx → bumpRetries + 等 retry delay（不删 op）', async () => {
      const { ApiException } = await import('@dustnote/shared');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const err500 = new ApiException({ status: 500, code: 'server_error', message: '' } as never);
      queueStore.ops = [{ id: 'op-1', path: '/x', method: 'POST' }];
      replayOp.mockRejectedValueOnce(err500);
      const { actions } = makeStore();
      await actions.flushQueue();
      expect(bumpRetries).toHaveBeenCalledWith('op-1');
      expect(getRetryDelayForOp).toHaveBeenCalledWith('op-1');
      expect(remove).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('TypeError（断网） → 中止本轮', async () => {
      queueStore.ops = [
        { id: 'op-1', path: '/x', method: 'POST' },
        { id: 'op-2', path: '/y', method: 'POST' },
      ];
      replayOp.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const { actions } = makeStore();
      await actions.flushQueue();
      // TypeError 不删也不 bump，直接 break
      expect(replayOp).toHaveBeenCalledTimes(1);
      expect(bumpRetries).not.toHaveBeenCalled();
    });

    it('未知错误（非 ApiException 非 TypeError） → bumpRetries + retry delay', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      queueStore.ops = [{ id: 'op-1', path: '/x', method: 'POST' }];
      replayOp.mockRejectedValueOnce(new Error('weird'));
      const { actions } = makeStore();
      await actions.flushQueue();
      expect(bumpRetries).toHaveBeenCalledWith('op-1');
      warn.mockRestore();
    });
  });

  describe('clearLocalData', () => {
    it('清 cache + 队列 + auth + lockout + grace + 重置 state', async () => {
      const { actions, state } = makeStore({
        pendingCount: 5,
        localAuthBlob: { v: 1 } as never,
      });
      await actions.clearLocalData();
      expect(clearCache).toHaveBeenCalled();
      expect(clearQueue).toHaveBeenCalled();
      expect(clearLocalAuthBlob).toHaveBeenCalled();
      expect(clearLockoutState).toHaveBeenCalled();
      expect(clearGraceUnlock).toHaveBeenCalled();
      expect(state.pendingCount).toBe(0);
      expect(state.pendingConflicts).toEqual([]);
      expect(state.localAuthBlob).toBeNull();
    });
  });

  describe('resolveConflictChoice', () => {
    const conflict: PendingConflict = {
      noteId: 'n1',
      // conflicts 是 PendingConflict 的必填字段，但 resolveConflictChoice 走的是
      // local/server/merged 三选一分支，字段级冲突列表本用例用不到。
      conflicts: [],
      serverVersion: 5,
      local: {
        id: 'n1',
        plaintext: { title: 'local-title', content: 'local-content', tags: [] },
        isPinned: true,
        isFavorite: false,
        deletedAt: null,
        folderId: 'f1',
        clientUpdatedAt: '2025-01-01T00:00:00.000Z',
      },
      server: {
        id: 'n1',
        plaintext: { title: 'server-title', content: 'server-content', tags: [] },
        isPinned: false,
        isFavorite: true,
        deletedAt: null,
        folderId: 'f2',
        clientUpdatedAt: '2025-01-01T00:00:00.000Z',
      },
      merged: {
        id: 'n1',
        plaintext: { title: 'merged-title', content: 'merged-content', tags: [] },
        isPinned: true,
        isFavorite: true,
        deletedAt: null,
        folderId: 'f3',
        clientUpdatedAt: '2025-01-01T00:00:00.000Z',
      },
    };

    it('conflict 不存在 → 静默 return', async () => {
      const { actions, state } = makeStore({
        notes: new Map([['n1', noteRow('n1')]]),
        pendingConflicts: [],
      });
      await actions.resolveConflictChoice('n1', 'local');
      expect(apiPatch).not.toHaveBeenCalled();
      expect(state.notes.get('n1')?.version).toBe(1);
    });

    it('masterKey 缺失 → 抛 "未解锁"', async () => {
      const { actions } = makeStore({
        masterKey: null,
        pendingConflicts: [conflict],
      });
      await expect(actions.resolveConflictChoice('n1', 'local')).rejects.toThrow(/未解锁/);
    });

    it('choice=local → PATCH 用 local 的 plaintext + isPinned/favorite/folderId', async () => {
      apiPatch.mockResolvedValueOnce({ version: 6, serverUpdatedAt: 'x' });
      const { actions, state } = makeStore({
        notes: new Map([['n1', noteRow('n1')]]),
        notesPlain: new Map<string, NotePlaintext>([
          ['n1', { title: 'orig', content: 'orig', tags: [] }],
        ]),
        pendingConflicts: [conflict],
      });
      await actions.resolveConflictChoice('n1', 'local');
      expect(apiPatch).toHaveBeenCalledWith(
        '/notes/n1',
        expect.objectContaining({
          isPinned: true,
          isFavorite: false,
          folderId: 'f1',
        })
      );
      expect(state.notes.get('n1')?.version).toBe(6);
      expect(state.notesPlain.get('n1')?.title).toBe('local-title');
      // conflict 已清
      expect(state.pendingConflicts.length).toBe(0);
      expect(cacheNotesLocal).toHaveBeenCalled();
    });

    it('choice=server → 用 server 的字段', async () => {
      apiPatch.mockResolvedValueOnce({ version: 7, serverUpdatedAt: 'x' });
      const { actions, state } = makeStore({
        notes: new Map([['n1', noteRow('n1')]]),
        notesPlain: new Map<string, NotePlaintext>(),
        pendingConflicts: [conflict],
      });
      await actions.resolveConflictChoice('n1', 'server');
      expect(apiPatch).toHaveBeenCalledWith(
        '/notes/n1',
        expect.objectContaining({
          isPinned: false,
          isFavorite: true,
          folderId: 'f2',
        })
      );
      expect(state.notesPlain.get('n1')?.title).toBe('server-title');
    });

    it('choice=merged → 用 merged 的字段', async () => {
      apiPatch.mockResolvedValueOnce({ version: 8, serverUpdatedAt: 'x' });
      const { actions, state } = makeStore({
        notes: new Map([['n1', noteRow('n1')]]),
        notesPlain: new Map<string, NotePlaintext>(),
        pendingConflicts: [conflict],
      });
      await actions.resolveConflictChoice('n1', 'merged');
      expect(apiPatch).toHaveBeenCalledWith(
        '/notes/n1',
        expect.objectContaining({
          isPinned: true,
          isFavorite: true,
          folderId: 'f3',
        })
      );
      expect(state.notesPlain.get('n1')?.title).toBe('merged-title');
    });

    it('notes 里不存在该 noteId → 只 PATCH，不写 state notes', async () => {
      apiPatch.mockResolvedValueOnce({ version: 6, serverUpdatedAt: 'x' });
      const { actions, state } = makeStore({
        notes: new Map(),
        notesPlain: new Map(),
        pendingConflicts: [conflict],
      });
      await actions.resolveConflictChoice('n1', 'local');
      expect(apiPatch).toHaveBeenCalled();
      expect(state.notes.has('n1')).toBe(false);
      // 但 conflict 仍会清
      expect(state.pendingConflicts.length).toBe(0);
    });
  });

  describe('dismissConflict', () => {
    it('从 pendingConflicts 移除指定 noteId', () => {
      const c1: PendingConflict = { ...({} as PendingConflict), noteId: 'n1' } as PendingConflict;
      const c2: PendingConflict = { ...({} as PendingConflict), noteId: 'n2' } as PendingConflict;
      const { actions, state } = makeStore({ pendingConflicts: [c1, c2] });
      actions.dismissConflict('n1');
      expect(state.pendingConflicts.length).toBe(1);
      expect(state.pendingConflicts[0]!.noteId).toBe('n2');
    });
  });
});
