/**
 * web/src/lib/slices/data-slice.ts 单测 —— applyRemoteNoteChanges（WS 推送处理）
 *
 * applyRemoteNoteChanges 处理服务端 WS 推送的笔记变更：
 *   - permanent_delete → 本地直接删除
 *   - 其他 → 拉服务端最新 → 复用旧明文（密文未变）或重解密
 *   - 404 → 同步移除本地
 *   - 异常 → 全量 loadAll 兜底
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
const cacheNotesLocal = vi.fn(async (..._args: unknown[]) => undefined);
const cacheFolders = vi.fn(async (..._args: unknown[]) => undefined);
const runOrEnqueue = vi.fn(async (..._args: unknown[]) => true);

vi.mock('../store-helpers', () => ({
  isTransientNetworkError: vi.fn(),
  runOrEnqueue: (...args: unknown[]) => runOrEnqueue(...args),
  api: () => ({
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
    patch: (...a: unknown[]) => apiPatch(...a),
    delete: (...a: unknown[]) => apiDelete(...a),
  }),
  cacheNotesLocal: (...args: unknown[]) => cacheNotesLocal(...args),
  deriveLocalKey: vi.fn(),
}));

vi.mock('../db', () => ({
  cacheFolders: (...args: unknown[]) => cacheFolders(...args),
  loadCachedNotes: vi.fn(),
  loadCachedFolders: vi.fn(),
}));

vi.mock('../device', () => ({
  randomUuid: vi.fn(() => 'uuid-mock'),
  getDeviceId: vi.fn(() => 'dev-1'),
}));

vi.mock('../toast', () => ({ toast: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k, changeLanguage: vi.fn() } }));
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
    decryptNote: vi.fn(async () => ({ title: 'decrypted', content: 'content', tags: [] })),
    parseEnvelope: vi.fn(() => true),
  };
});

import { createDataSlice } from './data-slice.js';
import type { StoreState } from '../store';
import type { NoteRow, NotePlaintext, ViewMode } from '../store-types';
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
  // actions.applyRemoteNoteChanges 等访问全部是强类型。
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
  // 用 spy 覆盖 state.loadAll（slice 自己也有 loadAll，所以必须在 slice 之后）
  combined.loadAll = vi.fn(async () => undefined);
  Object.assign(combined, initial);
  return { state: combined, actions: slice };
}

describe('data-slice applyRemoteNoteChanges（WS 推送）', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();
    cacheNotesLocal.mockClear();
  });

  it('standalone 模式 → 走 loadAll 兜底（不直接处理）', async () => {
    const { actions, state } = makeStore({
      mode: 'standalone',
      notes: new Map([['n1', noteRow('n1')]]),
    });
    await actions.applyRemoteNoteChanges([['n1', 'update']]);
    expect(state.loadAll).toHaveBeenCalled();
  });

  it('permanent_delete → 本地直接移除', async () => {
    const { actions, state } = makeStore({
      notes: new Map<string, NoteRow>([
        ['n1', noteRow('n1')],
        ['n2', noteRow('n2')],
      ]),
      notesPlain: new Map<string, NotePlaintext>([['n1', { title: 'a', content: 'a', tags: [] }]]),
    });
    await actions.applyRemoteNoteChanges([['n1', 'permanent_delete']]);
    expect(state.notes.has('n1')).toBe(false);
    expect(state.notesPlain.has('n1')).toBe(false);
    expect(state.notes.has('n2')).toBe(true);
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('update + 服务端 404 → 本地同步移除', async () => {
    const { ApiException } = await import('@dustnote/shared');
    apiGet.mockRejectedValueOnce(new ApiException({ status: 404, message: 'gone' } as never));
    const { actions, state } = makeStore({
      notes: new Map<string, NoteRow>([['n1', noteRow('n1')]]),
      notesPlain: new Map<string, NotePlaintext>([['n1', { title: 'a', content: 'a', tags: [] }]]),
    });
    await actions.applyRemoteNoteChanges([['n1', 'update']]);
    expect(state.notes.has('n1')).toBe(false);
    expect(state.notesPlain.has('n1')).toBe(false);
  });

  it('update + 服务端拉取成功 → 密文未变复用旧明文', async () => {
    const sameCipher = JSON.stringify({ v: 1, k: 'k', n: 'n', c: 'same' });
    apiGet.mockResolvedValueOnce(noteRow('n1', { ciphertext: sameCipher, version: 2 }));
    const { actions, state } = makeStore({
      notes: new Map<string, NoteRow>([['n1', noteRow('n1', { ciphertext: sameCipher })]]),
      notesPlain: new Map<string, NotePlaintext>([
        ['n1', { title: 'reuse', content: 'r', tags: [] }],
      ]),
    });
    await actions.applyRemoteNoteChanges([['n1', 'update']]);
    expect(state.notesPlain.get('n1')?.title).toBe('reuse');
    expect(state.notes.get('n1')?.version).toBe(2);
  });

  it('update + 密文变了 → 重解密 + 写明文', async () => {
    apiGet.mockResolvedValueOnce(noteRow('n1', { ciphertext: 'NEW-CIPHER', version: 5 }));
    const { actions, state } = makeStore({
      notes: new Map<string, NoteRow>([['n1', noteRow('n1', { ciphertext: 'OLD' })]]),
      notesPlain: new Map<string, NotePlaintext>([
        ['n1', { title: 'old', content: 'old', tags: [] }],
      ]),
    });
    await actions.applyRemoteNoteChanges([['n1', 'update']]);
    // decryptNote mock 返回 {title: 'decrypted', content: 'content', tags: []}
    expect(state.notesPlain.get('n1')?.title).toBe('decrypted');
    expect(state.notes.get('n1')?.version).toBe(5);
  });

  it('update + 非 ApiException 异常 → 触发 loadAll 兜底', async () => {
    apiGet.mockRejectedValueOnce(new Error('network fail'));
    const { actions, state } = makeStore({
      notes: new Map<string, NoteRow>([['n1', noteRow('n1')]]),
    });
    await actions.applyRemoteNoteChanges([['n1', 'update']]);
    expect(state.loadAll).toHaveBeenCalled();
  });

  it('update + masterKey 清零（锁屏） → 不写明文', async () => {
    apiGet.mockImplementationOnce(async () => {
      // simulate lock: by the time we check masterKey, it's null
      return noteRow('n1', { ciphertext: 'NEW', version: 2 });
    });
    const { actions, state } = makeStore({
      masterKey: null, // already locked
      notes: new Map<string, NoteRow>([['n1', noteRow('n1')]]),
      notesPlain: new Map<string, NotePlaintext>([
        ['n1', { title: 'old', content: 'old', tags: [] }],
      ]),
    });
    await actions.applyRemoteNoteChanges([['n1', 'update']]);
    // masterKey 缺失，跳过明文重写
    expect(state.notesPlain.get('n1')?.title).toBe('old');
  });

  it('多条 batch：一条失败 → loadAll 兜底一次（不再继续后续）', async () => {
    apiGet.mockRejectedValueOnce(new Error('fail1'));
    const { actions, state } = makeStore({
      notes: new Map<string, NoteRow>([
        ['n1', noteRow('n1')],
        ['n2', noteRow('n2')],
      ]),
    });
    await actions.applyRemoteNoteChanges([
      ['n1', 'update'],
      ['n2', 'update'],
    ]);
    expect(apiGet).toHaveBeenCalledTimes(1); // 第一条失败，break
    expect(state.loadAll).toHaveBeenCalledTimes(1);
  });
});
