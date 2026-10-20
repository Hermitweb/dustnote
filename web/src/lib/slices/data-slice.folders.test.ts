/**
 * web/src/lib/slices/data-slice.ts 单测 —— folders/permanentDeleteNote 剩余路径
 *
 * 覆盖 createFolder/renameFolder/moveFolder/deleteFolder/permanentDeleteNote
 * 的 standalone + online 双分支 + 各种边界（空名 / 自环 / 同 parentId 跳过）。
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
const runOrEnqueue = vi.fn(async (...args: unknown[]) => {
  const fn = args[1] as () => Promise<unknown>;
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
});
const cacheFolders = vi.fn(async (..._args: unknown[]) => undefined);
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
  cacheFolders: (...args: unknown[]) => cacheFolders(...args),
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

vi.mock('../offline-queue', () => ({
  enqueue: vi.fn(),
  clear: vi.fn(),
  flushQueue: vi.fn(),
}));

vi.mock('@dustnote/client-core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dustnote/client-core');
  return {
    ...actual,
    encryptNote: vi.fn(async () => ({ json: { v: 1, k: 'k', n: 'n', c: '' } })),
    decryptNote: vi.fn(async () => ({ title: '', content: '', tags: [] })),
    parseEnvelope: vi.fn(() => true),
  };
});

import { createDataSlice } from './data-slice.js';
import type { StoreState } from '../store';
import type { NoteRow, NotePlaintext, ViewMode } from '../store-types';
import type { CreateFolderInput, DataRepository } from '@dustnote/shared';
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
  // 五个 slice 的交集，故此处需要一次显式断言；断言之后 state.folders /
  // actions.createFolder 等访问全部是强类型。
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
  Object.assign(combined, initial);
  return { state: combined, actions: slice };
}

describe('data-slice folders + permanentDeleteNote', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();
    runOrEnqueue.mockClear();
    cacheFolders.mockClear();
    cacheNotesLocal.mockClear();
    isTransientNetworkError.mockReset();
    isTransientNetworkError.mockReturnValue(false);
  });

  describe('createFolder', () => {
    it('standalone：repository.createFolder + state 追加 + 正确计算 depth/parentId', async () => {
      const repoCreateFolder = vi.fn(async (n: CreateFolderInput) => `srv-${n.name}`);
      const { actions, state } = makeStore({
        mode: 'standalone',
        repository: { createFolder: repoCreateFolder } as unknown as DataRepository,
        folders: [{ id: 'p1', name: 'parent', parentId: null, depth: 1 } as never],
      });
      const id = await actions.createFolder('child', { parentId: 'p1' });
      expect(id).toBe('srv-child');
      expect(repoCreateFolder).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'child', parentId: 'p1' })
      );
      expect(state.folders.length).toBe(2);
      const child = state.folders[1]!;
      expect(child.parentId).toBe('p1');
      expect(child.depth).toBe(2);
    });

    it('online：POST /folders + state 追加', async () => {
      apiPost.mockResolvedValueOnce({ id: 'srv-f' });
      const { actions, state } = makeStore();
      const id = await actions.createFolder('Work', { branch: 'work' });
      expect(id).toBe('srv-f');
      expect(apiPost).toHaveBeenCalledWith(
        '/folders',
        expect.objectContaining({ name: 'Work', branch: 'work' })
      );
      expect(state.folders.length).toBe(1);
    });

    it('parentId 非法（虚拟/已删） → 归一为 null（F8）', async () => {
      const repoCreateFolder = vi.fn(async (n: CreateFolderInput) => `srv-${n.name}`);
      const { actions } = makeStore({
        mode: 'standalone',
        repository: { createFolder: repoCreateFolder } as unknown as DataRepository,
      });
      await actions.createFolder('orphan', { parentId: 'deleted-folder' });
      expect(repoCreateFolder).toHaveBeenCalledWith(expect.objectContaining({ parentId: null }));
    });
  });

  describe('renameFolder', () => {
    it('空名（含空白） → 抛 "文件夹名不能为空"', async () => {
      const { actions } = makeStore();
      await expect(actions.renameFolder('f1', '   ')).rejects.toThrow(/文件夹名不能为空/);
      expect(apiPatch).not.toHaveBeenCalled();
    });

    it('standalone：repository.renameFolder + state 更新 + trim', async () => {
      const repoRename = vi.fn(async () => undefined);
      const { actions, state } = makeStore({
        mode: 'standalone',
        repository: { renameFolder: repoRename } as unknown as DataRepository,
        folders: [{ id: 'f1', name: 'old', parentId: null, depth: 1 } as never],
      });
      await actions.renameFolder('f1', '  new name  ');
      expect(repoRename).toHaveBeenCalledWith('f1', 'new name');
      expect(state.folders[0]!.name).toBe('new name');
    });

    it('online：runOrEnqueue PATCH + state 更新 + cacheFolders', async () => {
      const { actions, state } = makeStore({
        folders: [{ id: 'f1', name: 'old', parentId: null, depth: 1 } as never],
      });
      await actions.renameFolder('f1', 'renamed');
      expect(apiPatch).toHaveBeenCalledWith('/folders/f1', { name: 'renamed' });
      expect(state.folders[0]!.name).toBe('renamed');
      expect(cacheFolders).toHaveBeenCalled();
    });
  });

  describe('moveFolder', () => {
    it('standalone：repository.moveFolder + state 更新 depth/parentId', async () => {
      const repoMove = vi.fn(async () => undefined);
      const { actions, state } = makeStore({
        mode: 'standalone',
        repository: { moveFolder: repoMove } as unknown as DataRepository,
        folders: [
          { id: 'p1', name: 'parent', parentId: null, depth: 1 } as never,
          { id: 'c1', name: 'child', parentId: null, depth: 1 } as never,
        ],
      });
      await actions.moveFolder('c1', 'p1');
      expect(repoMove).toHaveBeenCalledWith('c1', 'p1');
      const child = state.folders.find((f) => f.id === 'c1')!;
      expect(child.parentId).toBe('p1');
      expect(child.depth).toBe(2);
    });

    it('online：runOrEnqueue PATCH parentId + cacheFolders', async () => {
      const { actions } = makeStore({
        folders: [
          { id: 'p1', name: 'parent', parentId: null, depth: 1 } as never,
          { id: 'c1', name: 'child', parentId: null, depth: 1 } as never,
        ],
      });
      await actions.moveFolder('c1', 'p1');
      expect(apiPatch).toHaveBeenCalledWith('/folders/c1', { parentId: 'p1' });
      expect(cacheFolders).toHaveBeenCalled();
    });

    it('id === parentId（自环） → 归一为 null，拒绝挂自己下面', async () => {
      const repoMove = vi.fn(async () => undefined);
      const { actions, state } = makeStore({
        mode: 'standalone',
        repository: { moveFolder: repoMove } as unknown as DataRepository,
        folders: [{ id: 'f1', name: 'f', parentId: null, depth: 1 } as never],
      });
      await actions.moveFolder('f1', 'f1');
      expect(repoMove).toHaveBeenCalledWith('f1', null);
      expect(state.folders[0]!.parentId).toBe(null);
    });

    it('parentId 非法 → 归一为 null', async () => {
      const repoMove = vi.fn(async () => undefined);
      const { actions } = makeStore({
        mode: 'standalone',
        repository: { moveFolder: repoMove } as unknown as DataRepository,
        folders: [{ id: 'f1', name: 'f', parentId: null, depth: 1 } as never],
      });
      await actions.moveFolder('f1', 'ghost');
      expect(repoMove).toHaveBeenCalledWith('f1', null);
    });
  });

  describe('deleteFolder（级联）', () => {
    it('standalone：repository.deleteFolder + state filter + 子笔记 folderId 归一为 null', async () => {
      const repoDelFolder = vi.fn(async () => undefined);
      const { actions, state } = makeStore({
        mode: 'standalone',
        repository: { deleteFolder: repoDelFolder } as unknown as DataRepository,
        folders: [
          { id: 'p1', name: 'p', parentId: null, depth: 1 } as never,
          { id: 'c1', name: 'c', parentId: 'p1', depth: 2 } as never,
        ],
        notes: new Map<string, NoteRow>([
          ['n1', noteRow('n1', { folderId: 'p1' })],
          ['n2', noteRow('n2', { folderId: 'c1' })],
          ['n3', noteRow('n3', { folderId: null })],
        ]),
      });
      await actions.deleteFolder('p1');
      expect(repoDelFolder).toHaveBeenCalledWith('p1');
      // p1 和后代 c1 都被移除
      expect(state.folders.length).toBe(0);
      // n1/n2 的 folderId 都被归一为 null（级联）
      expect(state.notes.get('n1')?.folderId).toBeNull();
      expect(state.notes.get('n2')?.folderId).toBeNull();
      // n3 不动
      expect(state.notes.get('n3')?.folderId).toBeNull();
    });

    it('online：runOrEnqueue DELETE + 乐观删除 + cacheNotesLocal + cacheFolders', async () => {
      const { actions, state } = makeStore({
        folders: [
          { id: 'p1', name: 'p', parentId: null, depth: 1 } as never,
          { id: 'c1', name: 'c', parentId: 'p1', depth: 2 } as never,
        ],
        notes: new Map<string, NoteRow>([['n1', noteRow('n1', { folderId: 'p1' })]]),
      });
      await actions.deleteFolder('p1');
      expect(apiDelete).toHaveBeenCalledWith('/folders/p1');
      expect(state.folders.length).toBe(0);
      expect(state.notes.get('n1')?.folderId).toBeNull();
      expect(cacheNotesLocal).toHaveBeenCalled();
      expect(cacheFolders).toHaveBeenCalled();
    });

    it('选中的文件夹被删 → selectedFolderId 归一为 null', async () => {
      const repoDelFolder = vi.fn(async () => undefined);
      const { actions, state } = makeStore({
        mode: 'standalone',
        repository: { deleteFolder: repoDelFolder } as unknown as DataRepository,
        folders: [{ id: 'f1', name: 'f', parentId: null, depth: 1 } as never],
        selectedFolderId: 'f1',
      });
      await actions.deleteFolder('f1');
      expect(state.selectedFolderId).toBeNull();
    });
  });

  describe('permanentDeleteNote（物理删除）', () => {
    it('note id 不存在 → 静默 no-op', async () => {
      const { actions, state } = makeStore({
        selectedNoteId: 'n1',
      });
      await actions.permanentDeleteNote('nope');
      expect(apiDelete).not.toHaveBeenCalled();
      expect(state.selectedNoteId).toBe('n1');
    });

    it('standalone：repository.permanentDeleteNote + state 移除 + 若当前选中则清 selectedNoteId', async () => {
      const repoPerm = vi.fn(async () => undefined);
      const { actions, state } = makeStore({
        mode: 'standalone',
        repository: { permanentDeleteNote: repoPerm } as unknown as DataRepository,
        notes: new Map<string, NoteRow>([
          ['n1', noteRow('n1')],
          ['n2', noteRow('n2')],
        ]),
        notesPlain: new Map<string, NotePlaintext>([
          ['n1', { title: 't1', content: 'c1', tags: [] }],
        ]),
        selectedNoteId: 'n1',
      });
      await actions.permanentDeleteNote('n1');
      expect(repoPerm).toHaveBeenCalledWith('n1');
      expect(state.notes.has('n1')).toBe(false);
      expect(state.notesPlain.has('n1')).toBe(false);
      expect(state.selectedNoteId).toBeNull();
    });

    it('standalone：删除的不是当前选中 → selectedNoteId 保持', async () => {
      const repoPerm = vi.fn(async () => undefined);
      const { actions, state } = makeStore({
        mode: 'standalone',
        repository: { permanentDeleteNote: repoPerm } as unknown as DataRepository,
        notes: new Map<string, NoteRow>([
          ['n1', noteRow('n1')],
          ['n2', noteRow('n2')],
        ]),
        selectedNoteId: 'n2',
      });
      await actions.permanentDeleteNote('n1');
      expect(state.selectedNoteId).toBe('n2');
    });

    it('online：runOrEnqueue DELETE /notes/:id/permanent + cache', async () => {
      const { actions, state } = makeStore({
        notes: new Map<string, NoteRow>([['n1', noteRow('n1')]]),
        selectedNoteId: 'n1',
      });
      await actions.permanentDeleteNote('n1');
      expect(apiDelete).toHaveBeenCalledWith('/notes/n1/permanent');
      expect(state.notes.has('n1')).toBe(false);
      expect(state.selectedNoteId).toBeNull();
      expect(cacheNotesLocal).toHaveBeenCalled();
    });
  });
});
