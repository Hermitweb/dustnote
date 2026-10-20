/**
 * web/src/lib/slices/data-slice.ts 单测 —— CRUD 主体路径
 *
 * createNote / updateNote / deleteNote / moveNote / emptyTrash / restoreNote
 * / ensureDefaultContent 覆盖：
 *   - masterKey 缺失 → 抛错
 *   - standalone 模式（repository 路径）
 *   - online 模式（api + runOrEnqueue 路径）
 *   - 同 folderId / 不存在 → no-op 快速返回
 *   - 409 自愈拉最新 version 重试一次
 *   - emptyTrash transient error → 走离线队列入队 + isOnline=false
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installPolyfills } from '../../test/polyfills';

installPolyfills();

/* ---------- 共享 mock（hoisted 以绕开 vi.mock 工厂前置限制） ---------- */
// 统一用 rest 签名：mock 工厂里以 `(...args: unknown[]) => fn(...args)` 转发，
// 固定形参的 mock 在转发时会被 TS 判为 TS2556（spread 必须传元组或 rest 形参）。
const apiGet = vi.fn(async (..._args: unknown[]) => undefined as any);
const apiPost = vi.fn(async (..._args: unknown[]) => undefined as any);
const apiPatch = vi.fn(async (..._args: unknown[]) => undefined as any);
const apiDelete = vi.fn(async (..._args: unknown[]) => undefined as any);
const runOrEnqueue = vi.fn(async (...args: unknown[]) => {
  const fn = args[1] as () => Promise<unknown>;
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
});
const cacheNotesLocal = vi.fn(async (..._args: unknown[]) => undefined);
const isTransientNetworkError = vi.fn((..._args: unknown[]) => false);

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
  deriveLocalKey: vi.fn(),
}));

vi.mock('../db', () => ({
  cacheFolders: vi.fn(),
  loadCachedNotes: vi.fn(),
  loadCachedFolders: vi.fn(),
}));

vi.mock('../device', () => ({
  randomUuid: vi.fn(() => 'uuid-mock'),
  getDeviceId: vi.fn(() => 'dev-1'),
}));

vi.mock('../toast', () => ({
  toast: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock('../i18n', () => ({ default: { t: (k: string) => k, changeLanguage: vi.fn() } }));

const enqueueOffline = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../offline-queue', () => ({
  enqueue: (...args: unknown[]) => enqueueOffline(...args),
  clear: vi.fn(),
  flushQueue: vi.fn(),
}));

vi.mock('@dustnote/client-core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dustnote/client-core');
  return {
    ...actual,
    encryptNote: vi.fn(async (_k: unknown, pt: { title?: string; content?: string }) => ({
      json: { v: 1, k: 'k', n: 'n', c: pt.content ?? '' },
    })),
    decryptNote: vi.fn(async () => ({ title: '', content: '', tags: [] })),
    parseEnvelope: vi.fn(() => true),
  };
});

import { createDataSlice } from './data-slice.js';
import type { StoreState } from '../store';
import type { NoteRow, NotePlaintext, ViewMode } from '../store-types';
import type { CreateNoteInput, DataRepository } from '@dustnote/shared';
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
  // 五个 slice 的交集，故此处需要一次显式断言；断言之后 state.notes / actions.createNote
  // 等访问全部是强类型——测试与生产类型的偏差会在编译期暴露。此前用
  // `type S = Record<string, unknown>` 逃生舱把这些偏差全部掩盖了。
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
    createFolder: vi.fn(async (name: string) => {
      const id = `f-${name}`;
      (base.folders as Array<{ id: string; name: string }>).push({ id, name });
      return id;
    }),
    moveNote: vi.fn(),
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
  Object.assign(combined, initial);
  return { state: combined, actions: slice };
}

describe('data-slice CRUD 主体路径', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();
    runOrEnqueue.mockClear();
    cacheNotesLocal.mockClear();
    enqueueOffline.mockClear();
    isTransientNetworkError.mockReset();
    isTransientNetworkError.mockReturnValue(false);
  });

  describe('createNote', () => {
    it('masterKey 缺失 → 抛 "未解锁"', async () => {
      const { actions } = makeStore({ masterKey: null });
      await expect(actions.createNote()).rejects.toThrow(/未解锁/);
    });

    it('standalone 模式：repository.createNote + 写 state + selectedNoteId=新 id', async () => {
      const repoCreate = vi.fn(async (n: CreateNoteInput) => n.id);
      const { actions, state } = makeStore({
        mode: 'standalone',
        repository: { createNote: repoCreate } as unknown as DataRepository,
      });
      const id = await actions.createNote(null);
      expect(id).toBe('uuid-mock');
      expect(repoCreate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'uuid-mock', folderId: null })
      );
      expect(state.notes.size).toBe(1);
      expect(state.notesPlain.size).toBe(1);
      expect(state.selectedNoteId).toBe('uuid-mock');
    });

    it('online 模式：POST /notes + state 写入 + 默认标题 "新笔记"', async () => {
      apiPost.mockResolvedValueOnce({
        id: 'srv-id',
        serverUpdatedAt: '2025-02-01T00:00:00.000Z',
        version: 3,
      });
      const { actions, state } = makeStore();
      await actions.createNote(null);
      expect(apiPost).toHaveBeenCalledWith('/notes', expect.objectContaining({ id: 'uuid-mock' }));
      expect(state.notes.get('srv-id')?.version).toBe(3);
      expect(state.notesPlain.get('srv-id')?.title).toBe('新笔记');
      expect(state.selectedNoteId).toBe('srv-id');
    });

    it('folderId 非法 → 归一为 null（虚拟/已删 id 不落库）', async () => {
      const repoCreate = vi.fn(async (n: CreateNoteInput) => n.id);
      const { actions } = makeStore({
        mode: 'standalone',
        repository: { createNote: repoCreate } as unknown as DataRepository,
      });
      await actions.createNote('deleted-folder-id');
      expect(repoCreate).toHaveBeenCalledWith(expect.objectContaining({ folderId: null }));
    });

    it('standalone 无 repository → 走 online POST 路径', async () => {
      apiPost.mockResolvedValueOnce({
        id: 'srv-id',
        serverUpdatedAt: '2025-02-01T00:00:00.000Z',
        version: 1,
      });
      const { actions } = makeStore({ mode: 'standalone', repository: null });
      await actions.createNote(null);
      expect(apiPost).toHaveBeenCalled();
    });
  });

  describe('updateNote', () => {
    it('masterKey 缺失 → 抛 "未解锁"', async () => {
      const { actions } = makeStore({
        masterKey: null,
        notes: new Map([['n1', noteRow('n1')]]),
      });
      await expect(actions.updateNote('n1', { title: 'x' })).rejects.toThrow(/未解锁/);
      expect(apiPatch).not.toHaveBeenCalled();
    });

    it('note id 不存在 → 静默 no-op', async () => {
      const { actions } = makeStore();
      await actions.updateNote('nope', { title: 'x' });
      expect(apiPatch).not.toHaveBeenCalled();
    });

    it('notesPlain 缺失（损坏笔记） → console.warn + 不发请求', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { actions } = makeStore({
        notes: new Map([['corrupt', noteRow('corrupt')]]),
        notesPlain: new Map(),
      });
      await actions.updateNote('corrupt', { title: 'x' });
      expect(apiPatch).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith('skip updateNote for corrupt note', 'corrupt');
      warn.mockRestore();
    });

    it('online happy path：合并 patch → runOrEnqueue + cacheNotesLocal 写盘', async () => {
      apiPatch.mockResolvedValueOnce({ version: 2, serverUpdatedAt: '2025-03-01T00:00:00.000Z' });
      const { actions, state } = makeStore({
        notes: new Map([
          ['n1', noteRow('n1', { version: 1 })],
          ['n2', noteRow('n2')],
        ]),
        notesPlain: new Map<string, NotePlaintext>([
          ['n1', { title: 'old', content: 'old', tags: [] }],
        ]),
      });
      await actions.updateNote('n1', { title: 'new' });
      // runOrEnqueue 包了一层
      expect(runOrEnqueue).toHaveBeenCalled();
      // 内层 fn 应调 api.patch
      expect(apiPatch).toHaveBeenCalledWith('/notes/n1', expect.objectContaining({ version: 1 }));
      // 合并：title 更新
      expect(state.notesPlain.get('n1')?.title).toBe('new');
      expect(state.notesPlain.get('n1')?.content).toBe('old');
      // version 写回
      expect(state.notes.get('n1')?.version).toBe(2);
      // cache 写盘
      expect(cacheNotesLocal).toHaveBeenCalled();
    });

    it('online 409 自愈：拉 fresh version + 重试一次', async () => {
      const err409 = new (await import('@dustnote/shared')).ApiException({
        status: 409,
        code: 'version_mismatch',
        message: 'stale',
      } as never);
      apiPatch
        .mockRejectedValueOnce(err409)
        .mockResolvedValueOnce({ version: 5, serverUpdatedAt: 'x' });
      apiGet.mockResolvedValueOnce({ version: 5 });
      const { actions, state } = makeStore({
        notes: new Map([['n1', noteRow('n1', { version: 1 })]]),
        notesPlain: new Map<string, NotePlaintext>([
          ['n1', { title: 't', content: 'c', tags: [] }],
        ]),
      });
      await actions.updateNote('n1', { title: 'new' });
      expect(apiPatch).toHaveBeenCalledTimes(2);
      // 第二次用 fresh version
      expect(apiPatch.mock.calls[1]?.[1]).toMatchObject({ version: 5 });
      expect(state.notes.get('n1')?.version).toBe(5);
    });

    it('standalone：repository.updateNote 写本地 + cache', async () => {
      const repoUpdate = vi.fn(async () => 7);
      const { actions, state } = makeStore({
        mode: 'standalone',
        repository: { updateNote: repoUpdate } as unknown as DataRepository,
        notes: new Map([['n1', noteRow('n1', { version: 1 })]]),
        notesPlain: new Map<string, NotePlaintext>([
          ['n1', { title: 'old', content: 'old', tags: [] }],
        ]),
      });
      await actions.updateNote('n1', { title: 'new' });
      expect(repoUpdate).toHaveBeenCalled();
      expect(state.notes.get('n1')?.version).toBe(7);
      expect(state.notesPlain.get('n1')?.title).toBe('new');
      // 不走 runOrEnqueue（standalone 分支直接 return）
      expect(runOrEnqueue).not.toHaveBeenCalled();
    });
  });

  describe('deleteNote', () => {
    it('note id 不存在 → 静默 no-op', async () => {
      const { actions } = makeStore();
      await actions.deleteNote('nope');
      expect(apiDelete).not.toHaveBeenCalled();
    });

    it('standalone：repository.deleteNote + selectedNoteId=null', async () => {
      const repoDel = vi.fn(async () => undefined);
      const { actions, state } = makeStore({
        mode: 'standalone',
        repository: { deleteNote: repoDel } as unknown as DataRepository,
        notes: new Map([['n1', noteRow('n1')]]),
        selectedNoteId: 'n1',
      });
      await actions.deleteNote('n1');
      expect(repoDel).toHaveBeenCalledWith('n1');
      expect(state.notes.get('n1')?.deletedAt).toBeTruthy();
      expect(state.selectedNoteId).toBeNull();
    });

    it('online：runOrEnqueue DELETE + 乐观置 deletedAt + cache', async () => {
      const { actions, state } = makeStore({
        notes: new Map([['n1', noteRow('n1')]]),
        selectedNoteId: 'n1',
      });
      await actions.deleteNote('n1');
      expect(apiDelete).toHaveBeenCalledWith('/notes/n1');
      expect(state.notes.get('n1')?.deletedAt).toBeTruthy();
      expect(state.selectedNoteId).toBeNull();
    });
  });

  describe('moveNote', () => {
    it('note id 不存在 → 静默 no-op', async () => {
      const { actions } = makeStore();
      await actions.moveNote('nope', 'f1');
      expect(apiPatch).not.toHaveBeenCalled();
    });

    it('同 folderId → 跳过不发请求', async () => {
      const { actions } = makeStore({
        notes: new Map([['n1', noteRow('n1', { folderId: 'f1' })]]),
        folders: [{ id: 'f1', name: 'F1' } as never],
      });
      await actions.moveNote('n1', 'f1');
      expect(apiPatch).not.toHaveBeenCalled();
    });

    it('folderId 非法 → 归一为 null（与 createNote 同口径 F8）', async () => {
      const { actions } = makeStore({
        notes: new Map([['n1', noteRow('n1', { folderId: 'f1' })]]),
      });
      await actions.moveNote('n1', 'ghost-folder');
      expect(apiPatch).toHaveBeenCalledWith(
        '/notes/n1',
        expect.objectContaining({ folderId: null })
      );
    });

    it('standalone：repository.moveNote 写本地', async () => {
      const repoMove = vi.fn(async () => undefined);
      const { actions, state } = makeStore({
        mode: 'standalone',
        repository: { moveNote: repoMove } as unknown as DataRepository,
        notes: new Map([['n1', noteRow('n1')]]),
        folders: [{ id: 'f1', name: 'F1' } as never],
      });
      await actions.moveNote('n1', 'f1');
      expect(repoMove).toHaveBeenCalledWith('n1', 'f1');
      expect(state.notes.get('n1')?.folderId).toBe('f1');
    });

    it('online 409 自愈：拉 fresh version + 重试', async () => {
      const err409 = new (await import('@dustnote/shared')).ApiException({
        status: 409,
        code: 'version_mismatch',
        message: 'stale',
      } as never);
      apiPatch
        .mockRejectedValueOnce(err409)
        .mockResolvedValueOnce({ version: 5, serverUpdatedAt: 'x' });
      apiGet.mockResolvedValueOnce({ version: 5 });
      const { actions } = makeStore({
        notes: new Map([['n1', noteRow('n1', { version: 1 })]]),
        folders: [{ id: 'f1', name: 'F1' } as never],
      });
      await actions.moveNote('n1', 'f1');
      expect(apiPatch).toHaveBeenCalledTimes(2);
    });
  });

  describe('emptyTrash', () => {
    it('无已删笔记 → 直接 return（不发请求）', async () => {
      const { actions, state } = makeStore({
        notes: new Map([['n1', noteRow('n1', { deletedAt: null })]]),
      });
      await actions.emptyTrash();
      expect(apiDelete).not.toHaveBeenCalled();
      expect(state.notes.size).toBe(1);
    });

    it('standalone：repository.emptyTrash + state 清', async () => {
      const repoEmpty = vi.fn(async () => undefined);
      const { actions, state } = makeStore({
        mode: 'standalone',
        repository: { emptyTrash: repoEmpty } as unknown as DataRepository,
        notes: new Map<string, NoteRow>([
          ['n1', noteRow('n1', { deletedAt: '2025-01-01T00:00:00.000Z' })],
          ['n2', noteRow('n2', { deletedAt: null })],
        ]),
        notesPlain: new Map<string, NotePlaintext>([
          ['n1', { title: 't', content: 'c', tags: [] }],
        ]),
      });
      await actions.emptyTrash();
      expect(repoEmpty).toHaveBeenCalled();
      expect(state.notes.size).toBe(1);
      expect(state.notes.has('n1')).toBe(false);
    });

    it('online：DELETE 全部 + state 清', async () => {
      const { actions, state } = makeStore({
        notes: new Map<string, NoteRow>([
          ['n1', noteRow('n1', { deletedAt: '2025-01-01T00:00:00.000Z' })],
          ['n2', noteRow('n2', { deletedAt: '2025-01-01T00:00:00.000Z' })],
        ]),
      });
      await actions.emptyTrash();
      expect(apiDelete).toHaveBeenCalledTimes(2);
      expect(state.notes.size).toBe(0);
    });

    it('online：单条 404/409 → 跳过（其他仍处理）', async () => {
      const err404 = { err: { status: 404 } };
      apiDelete.mockRejectedValueOnce(err404).mockResolvedValueOnce(undefined);
      const { actions, state } = makeStore({
        notes: new Map<string, NoteRow>([
          ['n1', noteRow('n1', { deletedAt: '2025-01-01T00:00:00.000Z' })],
          ['n2', noteRow('n2', { deletedAt: '2025-01-01T00:00:00.000Z' })],
        ]),
      });
      await actions.emptyTrash();
      expect(apiDelete).toHaveBeenCalledTimes(2);
      expect(state.notes.size).toBe(0);
    });

    it('online：单条 transient error → 入离线队列 + isOnline=false', async () => {
      isTransientNetworkError.mockReturnValue(true);
      apiDelete.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const { actions, state } = makeStore({
        notes: new Map<string, NoteRow>([
          ['n1', noteRow('n1', { deletedAt: '2025-01-01T00:00:00.000Z' })],
        ]),
      });
      await actions.emptyTrash();
      expect(enqueueOffline).toHaveBeenCalledWith({
        method: 'DELETE',
        path: '/notes/n1/permanent',
        noteId: 'n1',
      });
      expect(state.isOnline).toBe(false);
    });
  });

  describe('restoreNote', () => {
    it('note id 不存在 → no-op', async () => {
      const { actions } = makeStore();
      await actions.restoreNote('nope');
      expect(apiPatch).not.toHaveBeenCalled();
    });

    it('note 未删 → no-op', async () => {
      const { actions } = makeStore({
        notes: new Map([['n1', noteRow('n1', { deletedAt: null })]]),
      });
      await actions.restoreNote('n1');
      expect(apiPatch).not.toHaveBeenCalled();
    });

    it('standalone：repository.restoreNote + state 清 deletedAt', async () => {
      const repoRestore = vi.fn(async () => undefined);
      const { actions, state } = makeStore({
        mode: 'standalone',
        repository: { restoreNote: repoRestore } as unknown as DataRepository,
        notes: new Map([['n1', noteRow('n1', { deletedAt: '2025-01-01T00:00:00.000Z' })]]),
      });
      await actions.restoreNote('n1');
      expect(repoRestore).toHaveBeenCalledWith('n1');
      expect(state.notes.get('n1')?.deletedAt).toBeNull();
    });

    it('online：runOrEnqueue PATCH + state 置 deletedAt=null', async () => {
      apiPatch.mockResolvedValueOnce({ version: 2, serverUpdatedAt: 'x' });
      const { actions, state } = makeStore({
        notes: new Map([
          ['n1', noteRow('n1', { deletedAt: '2025-01-01T00:00:00.000Z', version: 1 })],
        ]),
      });
      await actions.restoreNote('n1');
      expect(apiPatch).toHaveBeenCalledWith(
        '/notes/n1',
        expect.objectContaining({ deletedAt: null })
      );
      expect(state.notes.get('n1')?.deletedAt).toBeNull();
      expect(state.notes.get('n1')?.version).toBe(2);
    });

    it('online 409 自愈：拉 fresh version + 重试', async () => {
      const err409 = new (await import('@dustnote/shared')).ApiException({
        status: 409,
        code: 'version_mismatch',
        message: 'stale',
      } as never);
      apiPatch
        .mockRejectedValueOnce(err409)
        .mockResolvedValueOnce({ version: 5, serverUpdatedAt: 'x' });
      apiGet.mockResolvedValueOnce({ version: 5 });
      const { actions, state } = makeStore({
        notes: new Map([
          ['n1', noteRow('n1', { deletedAt: '2025-01-01T00:00:00.000Z', version: 1 })],
        ]),
      });
      await actions.restoreNote('n1');
      expect(apiPatch).toHaveBeenCalledTimes(2);
      expect(state.notes.get('n1')?.version).toBe(5);
    });
  });

  describe('ensureDefaultContent（首次引导）', () => {
    it('masterKey 缺失 → no-op（不创建文件夹）', async () => {
      const createFolderSpy = vi.fn();
      const { actions } = makeStore({ masterKey: null });
      actions.createFolder = createFolderSpy;
      await actions.ensureDefaultContent();
      expect(createFolderSpy).not.toHaveBeenCalled();
    });

    it('已有文件夹 → no-op（不重复注入）', async () => {
      const createFolderSpy = vi.fn();
      const { actions } = makeStore({
        folders: [{ id: 'f1', name: 'F1' } as never],
      });
      actions.createFolder = createFolderSpy;
      await actions.ensureDefaultContent();
      expect(createFolderSpy).not.toHaveBeenCalled();
    });

    it('未播种 + 0 文件夹 + 0 笔记 → 创建默认文件夹 + 写引导笔记 + localStorage 标记', async () => {
      // 清理前一轮测试留下的 seeded flag
      try {
        localStorage.removeItem('dustnote_seeded_online');
      } catch {
        /* ignore */
      }
      const createFolderMock = vi.fn(async (name: string) => `f-${name}`);
      const moveNoteMock = vi.fn(async () => undefined);
      // ensureDefaultContent 内部调 get().createNote(folderId)，需要 api.post 返回 id
      apiPost.mockResolvedValue({
        id: 'intro-id',
        serverUpdatedAt: '2025-01-01T00:00:00.000Z',
        version: 1,
      });
      const { actions, state } = makeStore({
        folders: [],
        notes: new Map(),
        createFolder: createFolderMock,
        moveNote: moveNoteMock,
      });
      // 覆盖 combined.createFolder（makeStore 里也通过 Object.assign 注入）
      state.createFolder = createFolderMock;
      state.moveNote = moveNoteMock;
      await actions.ensureDefaultContent();
      expect(createFolderMock).toHaveBeenCalled();
      expect(state.notes.size).toBe(1); // 引导笔记被创建
      expect(state.notesPlain.size).toBe(1);
      // 标记落盘
      expect(localStorage.getItem('dustnote_seeded_online')).toBe('1');
    });

    it('已播种（localStorage=1） → no-op（不再注入）', async () => {
      try {
        localStorage.setItem('dustnote_seeded_online', '1');
      } catch {
        /* ignore */
      }
      const createFolderSpy = vi.fn();
      const { actions, state } = makeStore({
        folders: [],
        notes: new Map(),
      });
      actions.createFolder = createFolderSpy;
      await actions.ensureDefaultContent();
      expect(state.notes.size).toBe(0);
      expect(createFolderSpy).not.toHaveBeenCalled();
    });

    it('未分类笔记迁移：notes 里有无 folderId 的 → 调 moveNote + toast.info', async () => {
      try {
        localStorage.removeItem('dustnote_seeded_online');
      } catch {
        /* ignore */
      }
      const createFolderMock = vi.fn(async (name: string) => `f-${name}`);
      const moveNoteMock = vi.fn(async (_id: string, _folderId: string | null) => {});
      // ensureDefaultContent 内部调 get().createNote(folderId)，需要 api.post 返回 id
      apiPost.mockResolvedValue({
        id: 'intro-id',
        serverUpdatedAt: '2025-01-01T00:00:00.000Z',
        version: 1,
      });
      const { actions, state } = makeStore({
        folders: [],
        notes: new Map<string, NoteRow>([['n-unfiled', noteRow('n-unfiled', { folderId: null })]]),
        notesPlain: new Map<string, NotePlaintext>([
          ['n-unfiled', { title: '未分类笔记', content: 'c', tags: [] }],
        ]),
        createFolder: createFolderMock,
        moveNote: moveNoteMock,
      });
      state.createFolder = createFolderMock;
      state.moveNote = moveNoteMock;
      await actions.ensureDefaultContent();
      expect(moveNoteMock).toHaveBeenCalledWith('n-unfiled', expect.stringMatching(/^f-/));
    });
  });
});
