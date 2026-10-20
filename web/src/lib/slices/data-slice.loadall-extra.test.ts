/**
 * web/src/lib/slices/data-slice.ts 单测 —— loadAll 剩余分支（Round 11）
 *
 * 覆盖 loadAll 的：
 *   - online 并发单飞（重复调用 → 共享同一 Promise）
 *   - cache 命中（cache.notes.size > 0 || cachedFolders.length > 0）→ 立即 set state
 *   - 增量解密：密文变了 → 重解密 + 写明文
 *   - 增量解密：密文未变且 plain 有 → 复用旧 plain
 *   - 增量解密：密文变了但 prev plain 缺失 → 走 decryptNote
 *   - 增量解密：parseEnvelope 抛错 → 写 {title:解密失败}
 *   - standalone preferences.language 写盘
 *   - standalone 无 preferences → 不写 localStorage
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installPolyfills } from '../../test/polyfills';

installPolyfills();

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();
// 统一用 rest 签名：mock 工厂里以 `(...args: unknown[]) => fn(...args)` 转发，
// 固定形参的 mock 在转发时会被 TS 判为 TS2556（spread 必须传元组或 rest 形参）。
const runOrEnqueue = vi.fn(async (..._args: unknown[]) => true);
const cacheNotesLocal = vi.fn(async (..._args: unknown[]) => undefined);
const cacheFolders = vi.fn(async (..._args: unknown[]) => undefined);
const isTransientNetworkError = vi.fn((..._args: unknown[]) => false);
const loadCachedNotes = vi.fn();
const loadCachedFolders = vi.fn();
const deriveLocalKey = vi.fn(async (..._args: unknown[]) => new Uint8Array(32).fill(0x33));

vi.mock('../store-helpers', () => ({
  isTransientNetworkError: (...args: unknown[]) => isTransientNetworkError(...args),
  runOrEnqueue: (...args: unknown[]) => runOrEnqueue(...args),
  api: () => ({
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
    patch: (...a: unknown[]) => apiPatch(...a),
    delete: (...a: unknown[]) => apiDelete(...a),
  }),
  cacheNotesLocal: (...args: unknown[]) => cacheNotesLocal(...args),
  deriveLocalKey: (...args: unknown[]) => deriveLocalKey(...args),
}));

vi.mock('../db', () => ({
  cacheFolders: (...args: unknown[]) => cacheFolders(...args),
  loadCachedNotes: (...args: unknown[]) => loadCachedNotes(...args),
  loadCachedFolders: (...args: unknown[]) => loadCachedFolders(...args),
}));

vi.mock('../device', () => ({
  randomUuid: vi.fn(() => 'uuid-mock'),
  getDeviceId: vi.fn(() => 'dev-1'),
}));

vi.mock('../toast', () => ({ toast: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../i18n', () => ({
  default: { t: (k: string) => k, changeLanguage: vi.fn() },
  LANGUAGE_STORAGE_KEY: 'dustnote.lang',
}));
vi.mock('../offline-queue', () => ({ enqueue: vi.fn(), clear: vi.fn(), flushQueue: vi.fn() }));

vi.mock('@dustnote/shared', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dustnote/shared');
  return {
    ...actual,
    ApiException: class ApiException extends Error {
      err: { status?: number; data?: unknown };
      constructor(e: { status: number; data?: unknown; message?: string }) {
        super(e.message ?? 'ApiException');
        this.err = { status: e.status, data: e.data };
      }
    },
  };
});

vi.mock('@dustnote/client-core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dustnote/client-core');
  return {
    ...actual,
    encryptNote: vi.fn(async () => ({ json: { v: 1, k: 'k', n: 'n', c: '' } })),
    decryptNote: vi.fn(async () => ({ title: 'plain', content: 'content', tags: [] })),
    parseEnvelope: vi.fn(() => true),
  };
});

import { createDataSlice } from './data-slice.js';
import type { StoreState } from '../store';
import type { NoteRow, NotePlaintext, ViewMode } from '../store-types';
import type { DataRepository } from '@dustnote/shared';
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
  // 断言集中在构造边界这一次：测试只装配 data-slice 关心的字段，而 StoreState 是
  // 五个 slice 的交集，故此处需要一次显式断言；断言之后 state.notes /
  // actions.loadAll 等访问全部是强类型。
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
    repository: null,
    refreshPendingCount: vi.fn(),
    ...initial,
  } as unknown as StoreState;
  const combined: StoreState = { ...base };
  const set: StoreApi<StoreState>['setState'] = (partial) => {
    const p = typeof partial === 'function' ? partial(combined) : partial;
    Object.assign(combined, p);
  };
  const get = () => combined;
  // zustand 的 StateCreator 签名是 (set, get, api)。data-slice 只用 set/get，
  // 这里给一个最小可用的 api 实现（subscribe 退订即可）。
  const api: StoreApi<StoreState> = {
    setState: set,
    getState: get,
    getInitialState: get,
    subscribe: () => () => undefined,
    destroy: () => undefined,
  };
  const slice = createDataSlice(set, get, api);
  Object.assign(combined, slice);
  combined.loadAll = vi.fn(async () => undefined);
  Object.assign(combined, initial);
  return { state: combined, actions: slice };
}

describe('data-slice.loadAll 剩余分支 Round11', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();
    cacheNotesLocal.mockClear();
    cacheFolders.mockClear();
    loadCachedNotes.mockReset();
    loadCachedFolders.mockReset();
    isTransientNetworkError.mockReset();
    isTransientNetworkError.mockReturnValue(false);
  });

  describe('concurrent-flight', () => {
    it('多次并发调用 → 只调一次 fetch（共享同一 Promise）', async () => {
      apiGet.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 30));
        return {
          notes: [noteRow('n1')],
          folders: [],
          templates: [],
        };
      });
      loadCachedNotes.mockResolvedValueOnce({ notes: new Map(), plain: new Map() });
      loadCachedFolders.mockResolvedValueOnce([]);
      const { actions } = makeStore();
      const p1 = actions.loadAll();
      const p2 = actions.loadAll();
      const p3 = actions.loadAll();
      await Promise.all([p1, p2, p3]);
      const firstPageCalls = apiGet.mock.calls.filter((c) => String(c[0]).startsWith('/notes'));
      expect(firstPageCalls.length).toBe(1);
    });
  });

  describe('cache-hit + delta-decrypt', () => {
    it('cache 有笔记 → 立即 set state', async () => {
      loadCachedNotes.mockResolvedValueOnce({
        notes: new Map([['cached-n1', noteRow('cached-n1')]]),
        plain: new Map<string, NotePlaintext>(),
      });
      loadCachedFolders.mockResolvedValueOnce([{ id: 'f1', name: 'F' } as never]);
      apiGet
        .mockResolvedValueOnce({ notes: [noteRow('cached-n1')], nextCursor: null })
        .mockResolvedValueOnce({ folders: [{ id: 'f1', name: 'F' }] })
        .mockResolvedValueOnce({ templates: [] });
      const { actions, state } = makeStore();
      await actions.loadAll();
      expect(state.folders.length).toBeGreaterThanOrEqual(1);
      expect(state.notes.has('cached-n1')).toBe(true);
    });

    it('增量解密 — 密文变了 + prev cipher 不匹配 → 重解密', async () => {
      const oldCipher = JSON.stringify({ v: 1, k: 'k', n: 'n', c: 'OLD' });
      const newCipher = JSON.stringify({ v: 1, k: 'k', n: 'n', c: 'NEW' });
      loadCachedNotes.mockResolvedValueOnce({ notes: new Map(), plain: new Map() });
      loadCachedFolders.mockResolvedValueOnce([]);
      apiGet
        .mockResolvedValueOnce({
          notes: [noteRow('n1', { ciphertext: newCipher, version: 2 })],
          nextCursor: null,
        })
        .mockResolvedValueOnce({ folders: [] })
        .mockResolvedValueOnce({ templates: [] });
      const { actions, state } = makeStore({
        notes: new Map<string, NoteRow>([
          ['n1', noteRow('n1', { ciphertext: oldCipher, version: 1 })],
        ]),
        notesPlain: new Map<string, NotePlaintext>([
          ['n1', { title: 'old-title', content: 'old-content', tags: [] }],
        ]),
      });
      await actions.loadAll();
      expect(state.notesPlain.get('n1')?.title).toBe('plain');
      expect(state.notes.get('n1')?.version).toBe(2);
    });

    it('增量解密 — 密文未变 + 已有 plain → 复用旧 plain', async () => {
      const sameCipher = JSON.stringify({ v: 1, k: 'k', n: 'n', c: 'same' });
      loadCachedNotes.mockResolvedValueOnce({ notes: new Map(), plain: new Map() });
      loadCachedFolders.mockResolvedValueOnce([]);
      apiGet
        .mockResolvedValueOnce({
          notes: [noteRow('n1', { ciphertext: sameCipher, version: 5 })],
          nextCursor: null,
        })
        .mockResolvedValueOnce({ folders: [] })
        .mockResolvedValueOnce({ templates: [] });
      const { actions, state } = makeStore({
        notes: new Map<string, NoteRow>([['n1', noteRow('n1', { ciphertext: sameCipher })]]),
        notesPlain: new Map<string, NotePlaintext>([
          ['n1', { title: 'reuse-me', content: 'reuse', tags: [] }],
        ]),
      });
      await actions.loadAll();
      expect(state.notesPlain.get('n1')?.title).toBe('reuse-me');
      expect(state.notes.get('n1')?.version).toBe(5);
    });

    it('增量解密 — 密文一致但 prev plain 缺失 → 走 decryptNote', async () => {
      const sameCipher = JSON.stringify({ v: 1, k: 'k', n: 'n', c: 'same' });
      loadCachedNotes.mockResolvedValueOnce({ notes: new Map(), plain: new Map() });
      loadCachedFolders.mockResolvedValueOnce([]);
      apiGet
        .mockResolvedValueOnce({
          notes: [noteRow('n1', { ciphertext: sameCipher, version: 2 })],
          nextCursor: null,
        })
        .mockResolvedValueOnce({ folders: [] })
        .mockResolvedValueOnce({ templates: [] });
      const { actions, state } = makeStore({
        notes: new Map<string, NoteRow>([['n1', noteRow('n1', { ciphertext: sameCipher })]]),
        notesPlain: new Map(),
      });
      await actions.loadAll();
      expect(state.notesPlain.get('n1')?.title).toBe('plain');
    });

    it('增量解密 — parseEnvelope 抛错 → 写 {title:解密失败}', async () => {
      const { parseEnvelope } = await import('@dustnote/client-core');
      (parseEnvelope as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('bad envelope');
      });
      loadCachedNotes.mockResolvedValueOnce({ notes: new Map(), plain: new Map() });
      loadCachedFolders.mockResolvedValueOnce([]);
      apiGet
        .mockResolvedValueOnce({
          notes: [noteRow('n1', { ciphertext: 'NEW-CIPHER' })],
          nextCursor: null,
        })
        .mockResolvedValueOnce({ folders: [] })
        .mockResolvedValueOnce({ templates: [] });
      const { actions, state } = makeStore({
        // 旧密文不同 → 进入 decryptNote 分支 → parseEnvelope 抛错 → catch
        notes: new Map<string, NoteRow>([['n1', noteRow('n1', { ciphertext: 'OLD-CIPHER' })]]),
        notesPlain: new Map<string, NotePlaintext>([
          ['n1', { title: 'old', content: 'old', tags: [] }],
        ]),
      });
      await actions.loadAll();
      expect(state.notesPlain.get('n1')?.title).toBe('解密失败');
    });
  });

  describe('standalone-preferences-write', () => {
    it('standalone 路径 preferences.language 写 localStorage + changeLanguage', async () => {
      localStorage.removeItem('dustnote.lang');
      const repoLoad = vi.fn(async () => ({
        notes: [],
        folders: [],
        preferences: { language: 'en' },
      }));
      const { actions } = makeStore({
        mode: 'standalone',
        repository: { loadAll: repoLoad } as unknown as DataRepository,
      });
      await actions.loadAll();
      expect(localStorage.getItem('dustnote.lang')).toBe('en');
    });

    it('standalone 路径无 preferences → 不写 localStorage', async () => {
      localStorage.removeItem('dustnote.lang');
      const repoLoad = vi.fn(async () => ({
        notes: [],
        folders: [],
        preferences: null,
      }));
      const { actions } = makeStore({
        mode: 'standalone',
        repository: { loadAll: repoLoad } as unknown as DataRepository,
        masterKey: null,
      });
      await actions.loadAll();
      expect(localStorage.getItem('dustnote.lang')).toBeNull();
    });
  });
});
