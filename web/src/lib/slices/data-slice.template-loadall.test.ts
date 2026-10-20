/**
 * web/src/lib/slices/data-slice.ts 单测 —— createNoteFromTemplate 主体路径
 *
 * 覆盖：
 *   - masterKey 缺失 → 抛错
 *   - 模板不存在 → 抛错
 *   - preset 模板：直接 fillTemplatePlaceholders，不调 decryptString
 *   - user 模板：decryptString + parse
 *   - user 模板 decryptString 失败 → 抛错
 *   - standalone vs online
 *   - folderId 归一（F8）
 *   - 标题抽取（# → strip；无 → 模板名）
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

vi.mock('../toast', () => ({
  toast: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock('../i18n', () => ({
  default: { t: (k: string) => k, changeLanguage: vi.fn() },
  LANGUAGE_STORAGE_KEY: 'dustnote.lang',
}));

vi.mock('../offline-queue', () => ({
  enqueue: vi.fn(),
  clear: vi.fn(),
  flushQueue: vi.fn(),
}));

vi.mock('@dustnote/shared', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dustnote/shared');
  return {
    ...actual,
    decryptString: vi.fn(async () => '{"title":"","content":"# Hello\\nBody","tags":[]}'),
    fillTemplatePlaceholders: vi.fn((s: string) => s),
  };
});

vi.mock('@dustnote/client-core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dustnote/client-core');
  return {
    ...actual,
    encryptNote: vi.fn(async (_k: unknown, pt: { title?: string; content?: string }) => ({
      json: { v: 1, k: 'k', n: 'n', c: pt.content ?? '' },
    })),
    decryptNote: vi.fn(async () => ({ title: '', content: '', tags: [] })),
    parseEnvelope: vi.fn(() => ({ payload: 'enc', v: 1, k: 1, n: 'n' })),
  };
});

import { createDataSlice } from './data-slice.js';
import type { StoreState } from '../store';
import type { NoteRow, NotePlaintext, ViewMode } from '../store-types';
import type { CreateNoteInput, DataRepository, Template } from '@dustnote/shared';
import type { StoreApi } from 'zustand';

function templateRow(id: string, overrides: Partial<Template> = {}): Template {
  // 断言集中在 fixture 边界：Template.description 本用例用不到（createNoteFromTemplate
  // 只读 isPreset / content / name），故整体断言成 Template。
  return {
    id,
    userId: null,
    name: id,
    isPreset: false,
    category: 'custom',
    icon: 'note',
    content: '{"title":"","content":"","tags":[]}',
    sortOrder: 1,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  } as unknown as Template;
}

function makeStore(initial: Partial<StoreState> = {}) {
  // 断言集中在构造边界这一次：测试只装配 data-slice 关心的字段，而 StoreState 是
  // 五个 slice 的交集，故此处需要一次显式断言；断言之后 state.templates /
  // actions.createNoteFromTemplate 等访问全部是强类型。
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

describe('data-slice createNoteFromTemplate', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();
  });

  it('masterKey 缺失 → 抛 "未解锁"', async () => {
    const { actions } = makeStore({ masterKey: null, templates: [templateRow('t1')] });
    await expect(actions.createNoteFromTemplate('t1')).rejects.toThrow(/未解锁/);
  });

  it('模板不存在 → 抛 "模板不存在"', async () => {
    const { actions } = makeStore({ templates: [] });
    await expect(actions.createNoteFromTemplate('missing')).rejects.toThrow(/模板不存在/);
  });

  it('preset 模板：直接用 fillTemplatePlaceholders + 不调 decryptString', async () => {
    const { decryptString } = await import('@dustnote/shared');
    apiPost.mockResolvedValueOnce({ id: 'srv-1', serverUpdatedAt: 'x', version: 1 });
    const tpl: Template = {
      ...templateRow('tpl-preset'),
      isPreset: true,
      content: 'plain content for preset',
    };
    const { actions, state } = makeStore({ templates: [tpl] });
    await actions.createNoteFromTemplate('tpl-preset');
    expect(decryptString).not.toHaveBeenCalled();
    expect(state.notes.size).toBe(1);
    expect(state.notesPlain.get('srv-1')?.content).toBe('plain content for preset');
  });

  it('user 模板：decryptString → JSON.parse + fillTemplatePlaceholders', async () => {
    apiPost.mockResolvedValueOnce({ id: 'srv-1', serverUpdatedAt: 'x', version: 1 });
    const { actions, state } = makeStore({
      templates: [templateRow('tpl-user', { content: 'enc-payload' })],
    });
    await actions.createNoteFromTemplate('tpl-user');
    // decryptString mock 返回 '{"title":"","content":"# Hello\\nBody","tags":[]}'，
    // JSON.parse 后 content="# Hello\nBody"，fillTemplatePlaceholders 原样返回
    expect(state.notesPlain.get('srv-1')?.content).toContain('Hello');
  });

  it('user 模板 decryptString 抛错 → bubble up', async () => {
    const { decryptString } = await import('@dustnote/shared');
    (decryptString as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('decrypt-fail');
    });
    const { actions } = makeStore({
      templates: [templateRow('tpl-user', { content: 'enc' })],
    });
    await expect(actions.createNoteFromTemplate('tpl-user')).rejects.toThrow(/decrypt-fail/);
  });

  it('standalone：repository.createNote + state 写入 + selectedNoteId', async () => {
    const repoCreate = vi.fn(async (n: CreateNoteInput) => n.id);
    const { actions, state } = makeStore({
      mode: 'standalone',
      repository: { createNote: repoCreate } as unknown as DataRepository,
      templates: [templateRow('tpl-preset', { isPreset: true, content: 'inline content' })],
    });
    const id = await actions.createNoteFromTemplate('tpl-preset');
    expect(id).toBe('uuid-mock');
    expect(repoCreate).toHaveBeenCalled();
    expect(state.selectedNoteId).toBe('uuid-mock');
  });

  it('folderId 非法（"ghost"）→ 归一为 null', async () => {
    apiPost.mockResolvedValueOnce({ id: 'srv-1', serverUpdatedAt: 'x', version: 1 });
    const { actions } = makeStore({
      templates: [templateRow('tpl-preset', { isPreset: true, content: 'x' })],
    });
    await actions.createNoteFromTemplate('tpl-preset', 'ghost-folder');
    expect(apiPost).toHaveBeenCalledWith('/notes', expect.objectContaining({ folderId: null }));
  });

  it('folderId=null + 0 文件夹 → 留 null（F8）', async () => {
    apiPost.mockResolvedValueOnce({ id: 'srv-1', serverUpdatedAt: 'x', version: 1 });
    const { actions } = makeStore({
      templates: [templateRow('tpl-preset', { isPreset: true, content: 'x' })],
      folders: [],
    });
    await actions.createNoteFromTemplate('tpl-preset', null);
    expect(apiPost).toHaveBeenCalledWith('/notes', expect.objectContaining({ folderId: null }));
  });

  it('首行 # 标题抽取（# Project A → title="Project A"）', async () => {
    apiPost.mockResolvedValueOnce({ id: 'srv-1', serverUpdatedAt: 'x', version: 1 });
    const { actions, state } = makeStore({
      templates: [templateRow('tpl-preset', { isPreset: true, content: '# Project A\nbody' })],
    });
    await actions.createNoteFromTemplate('tpl-preset');
    expect(state.notesPlain.get('srv-1')?.title).toBe('Project A');
  });

  it('首行空（content=""） → 标题用模板名兜底', async () => {
    apiPost.mockResolvedValueOnce({ id: 'srv-1', serverUpdatedAt: 'x', version: 1 });
    const { actions, state } = makeStore({
      templates: [templateRow('tpl-preset', { isPreset: true, name: 'Fallback', content: '' })],
    });
    await actions.createNoteFromTemplate('tpl-preset');
    expect(state.notesPlain.get('srv-1')?.title).toBe('Fallback');
  });
});
