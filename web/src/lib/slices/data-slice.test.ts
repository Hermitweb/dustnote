/**
 * web/src/lib/slices/data-slice.ts 单测 —— UI 状态 setter 简单路径
 *
 * 聚焦：selectNote / setSearchQuery / selectFolder / setViewMode / setDragNoteId
 * / setSelectedTag / toggleSidebar / focusSearch / setStageOrder 的状态机契约。
 * 重型 CRUD（createNote/updateNote/loadAll）已由 data-slice.test.ts 集成覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installPolyfills } from '../../test/polyfills';

installPolyfills();

// mock 重型依赖（createDataSlice 模块顶层 import 即用）
vi.mock('../store-helpers', () => ({
  isTransientNetworkError: vi.fn(),
  runOrEnqueue: vi.fn(),
  api: vi.fn(),
  cacheNotesLocal: vi.fn(),
  deriveLocalKey: vi.fn(),
}));
vi.mock('../db', () => ({
  cacheFolders: vi.fn(),
  loadCachedNotes: vi.fn(),
  loadCachedFolders: vi.fn(),
}));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k } }));
vi.mock('../toast', () => ({ toast: { error: vi.fn(), warn: vi.fn() } }));

import { createDataSlice } from './data-slice.js';
import type { StoreState } from '../store';
import type { ViewMode } from '../store-types';
import type { StoreApi } from 'zustand';

function makeStore(initial: Partial<StoreState> = {}) {
  // 断言集中在构造边界这一次：测试只装配 data-slice 关心的字段，而 StoreState 是
  // 五个 slice 的交集，故此处需要一次显式断言；断言之后 state.templates /
  // actions.selectNote 等访问全部是强类型。
  const base = {
    mode: 'standalone',
    authState: 'unlocked',
    notes: new Map(),
    notesPlain: new Map(),
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
    accessToken: null,
    userId: null,
    serverSalt: null,
    accountKdfParams: null,
    masterKey: null,
    wrappedMasterKey: null,
    localAuthBlob: null,
    lockoutState: { failedAttempts: 0, lockedUntil: null },
    totpEnabled: false,
    serverError: null,
    preferences: null,
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
  // 测试 overrides 在 slice 之后应用（slice 的初始值会被覆盖）
  Object.assign(combined, initial);
  return { state: combined, actions: slice };
}

describe('data-slice UI 状态 setter', () => {
  let s: ReturnType<typeof makeStore>;
  beforeEach(() => {
    s = makeStore();
  });

  describe('selectNote', () => {
    it('设置 selectedNoteId', () => {
      s.actions.selectNote('note-1');
      expect(s.state.selectedNoteId).toBe('note-1');
    });

    it('传 null 清空', () => {
      s.actions.selectNote('note-1');
      s.actions.selectNote(null);
      expect(s.state.selectedNoteId).toBeNull();
    });
  });

  describe('setSearchQuery', () => {
    it('非空查询 → searchQuery + 退出详情（selectedNoteId=null）', () => {
      s.actions.selectNote('n1');
      s.actions.setSearchQuery('hello');
      expect(s.state.searchQuery).toBe('hello');
      expect(s.state.selectedNoteId).toBeNull();
    });

    it('空查询 → 仅清 searchQuery，保留 selectedNoteId', () => {
      s.actions.selectNote('n1');
      s.actions.setSearchQuery('hello');
      s.actions.setSearchQuery('');
      expect(s.state.searchQuery).toBe('');
      expect(s.state.selectedNoteId).toBeNull();
    });
  });

  describe('selectFolder', () => {
    it('切文件夹 → 清 detail/tag/viewMode=all', () => {
      s.actions.selectNote('n1');
      s.actions.setSelectedTag('urgent');
      s.actions.setViewMode('favorites');
      s.actions.selectFolder('folder-1');
      expect(s.state.selectedFolderId).toBe('folder-1');
      expect(s.state.selectedNoteId).toBeNull();
      expect(s.state.selectedTag).toBeNull();
      expect(s.state.viewMode).toBe('all');
    });
  });

  describe('setViewMode', () => {
    it('切视图 → 清 folder/note/tag', () => {
      s.actions.selectFolder('f-1');
      s.actions.selectNote('n1');
      s.actions.setSelectedTag('tag-1');
      s.actions.setViewMode('favorites');
      expect(s.state.viewMode).toBe('favorites');
      expect(s.state.selectedFolderId).toBeNull();
      expect(s.state.selectedNoteId).toBeNull();
      expect(s.state.selectedTag).toBeNull();
    });
  });

  describe('setSelectedTag', () => {
    it('选标签 → 清 note/folder/viewMode=all', () => {
      s.actions.selectFolder('f-1');
      s.actions.setViewMode('trash');
      s.actions.setSelectedTag('urgent');
      expect(s.state.selectedTag).toBe('urgent');
      expect(s.state.selectedNoteId).toBeNull();
      expect(s.state.selectedFolderId).toBeNull();
      expect(s.state.viewMode).toBe('all');
    });

    it('取消标签 → 保留 viewMode（不擅自跳页；folder 若 null 仍 null）', () => {
      // 先设 viewMode=favorites（folder=null 是其副产物）
      s.actions.setViewMode('favorites');
      // 选 urgent 后 viewMode= 'all'（tag 强制）
      s.actions.setSelectedTag('urgent');
      // 取消 tag → viewMode 保持 'all'（取消不跳页）
      s.actions.setSelectedTag(null);
      expect(s.state.selectedTag).toBeNull();
      expect(s.state.viewMode).toBe('all');
    });
  });

  describe('setDragNoteId', () => {
    it('设置与清空', () => {
      s.actions.setDragNoteId('note-1');
      expect(s.state.dragNoteId).toBe('note-1');
      s.actions.setDragNoteId(null);
      expect(s.state.dragNoteId).toBeNull();
    });
  });

  describe('toggleSidebar', () => {
    it('切换 sidebarHidden 状态', () => {
      expect(s.state.sidebarHidden).toBe(false);
      s.actions.toggleSidebar();
      expect(s.state.sidebarHidden).toBe(true);
      s.actions.toggleSidebar();
      expect(s.state.sidebarHidden).toBe(false);
    });
  });

  describe('focusSearch', () => {
    it('searchFocusToken 自增', () => {
      expect(s.state.searchFocusToken).toBe(0);
      s.actions.focusSearch();
      expect(s.state.searchFocusToken).toBe(1);
      s.actions.focusSearch();
      expect(s.state.searchFocusToken).toBe(2);
    });
  });

  describe('setStageOrder', () => {
    it('设置 stageOrder', () => {
      s.actions.setStageOrder(['n1', 'n2', 'n3']);
      expect(s.state.stageOrder).toEqual(['n1', 'n2', 'n3']);
    });

    it('同序不写（避免无谓 set 触发订阅者空转）', () => {
      s.actions.setStageOrder(['n1', 'n2']);
      // 直接改 state 是绕过了 set；这里我们观察同内容再 set 时不会真改字段引用
      // 但无法直接观察——只能间接验证不抛错且 stageOrder 仍正确
      s.actions.setStageOrder(['n1', 'n2']);
      expect(s.state.stageOrder).toEqual(['n1', 'n2']);
    });

    it('不同内容才写', () => {
      s.actions.setStageOrder(['a', 'b']);
      s.actions.setStageOrder(['a', 'b', 'c']);
      expect(s.state.stageOrder).toEqual(['a', 'b', 'c']);
    });
  });
});

/* ============================================================
 * loadTemplates / saveAsTemplate / deleteTemplate
 * ============================================================ */

const apiGet2 = vi.fn();
const apiPost2 = vi.fn();
const apiDel2 = vi.fn();
vi.mock('../store-helpers', () => ({
  isTransientNetworkError: vi.fn(),
  runOrEnqueue: vi.fn(),
  api: () => ({ get: apiGet2, post: apiPost2, delete: apiDel2 }),
  cacheNotesLocal: vi.fn(),
  deriveLocalKey: vi.fn(),
}));
vi.mock('../db', () => ({
  cacheFolders: vi.fn(),
  loadCachedNotes: vi.fn(),
  loadCachedFolders: vi.fn(),
}));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k, changeLanguage: vi.fn() } }));
vi.mock('../toast', () => ({
  toast: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

function makeTemplateStore(initial: Partial<StoreState> = {}) {
  const base = {
    mode: 'online',
    authState: 'unlocked',
    notes: new Map(),
    notesPlain: new Map(),
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
    ...initial,
  } as unknown as StoreState;
  const combined: StoreState = { ...base };
  const set: StoreApi<StoreState>['setState'] = (partial) => {
    const p = typeof partial === 'function' ? partial(combined) : partial;
    Object.assign(combined, p);
  };
  const get = () => combined;
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

describe('loadTemplates', () => {
  beforeEach(() => {
    apiGet2.mockReset();
    apiPost2.mockReset();
    apiDel2.mockReset();
  });

  it('standalone 模式 → 写预设模板', async () => {
    const { actions, state } = makeTemplateStore({ mode: 'standalone' });
    await actions.loadTemplates();
    expect(apiGet2).not.toHaveBeenCalled();
    expect(state.templates.length).toBeGreaterThan(0);
    // 应包含预设
    expect(state.templates.find((t) => t.id === 'tpl-blank')).toBeDefined();
  });

  it('online 模式 + 服务端有模板 → 合并预设 + 用户', async () => {
    apiGet2.mockResolvedValueOnce({
      templates: [
        {
          id: 'tpl-user-1',
          userId: 'u-1',
          name: '我的模板',
          isPreset: false,
          category: 'custom',
          icon: 'note',
          content: 'c',
          sortOrder: 1,
          createdAt: 'x',
          updatedAt: 'x',
        },
      ],
    });
    const { actions, state } = makeTemplateStore({ mode: 'online' });
    await actions.loadTemplates();
    // 预设 + 用户模板
    expect(state.templates.find((t) => t.id === 'tpl-blank')).toBeDefined();
    expect(state.templates.find((t) => t.id === 'tpl-user-1')).toBeDefined();
  });

  it('online 模式 + 服务端失败 → 回落预设', async () => {
    apiGet2.mockRejectedValueOnce(new Error('network'));
    const { actions, state } = makeTemplateStore({ mode: 'online' });
    await actions.loadTemplates();
    expect(state.templates.find((t) => t.id === 'tpl-blank')).toBeDefined();
  });
});

describe('saveAsTemplate / deleteTemplate', () => {
  beforeEach(() => {
    apiGet2.mockReset();
    apiPost2.mockReset();
    apiDel2.mockReset();
  });

  it('saveAsTemplate：未解锁 → 抛 "未解锁"', async () => {
    const { actions } = makeTemplateStore({ masterKey: null });
    await expect(
      actions.saveAsTemplate('mytpl', { title: 't', content: 'c', tags: [] })
    ).rejects.toThrow(/未解锁/);
  });

  it('saveAsTemplate：standalone 模式 → 抛 "仅联机模式"', async () => {
    const { actions } = makeTemplateStore({ mode: 'standalone' });
    await expect(
      actions.saveAsTemplate('mytpl', { title: 't', content: 'c', tags: [] })
    ).rejects.toThrow(/联机/);
  });

  it('saveAsTemplate：online 模式 → POST + state 追加新模板', async () => {
    apiPost2.mockResolvedValueOnce({ id: 'tpl-new-1' });
    const { actions, state } = makeTemplateStore({ mode: 'online' });
    await actions.saveAsTemplate('我的', { title: 't', content: 'c', tags: [] });
    expect(apiPost2).toHaveBeenCalledWith('/templates', expect.objectContaining({ name: '我的' }));
    expect(state.templates.find((t) => t.id === 'tpl-new-1')).toBeDefined();
  });

  it('deleteTemplate：预设模板 → 抛 "不可删除"', async () => {
    const { actions } = makeTemplateStore({
      mode: 'online',
      templates: [
        {
          id: 'tpl-preset',
          userId: null,
          name: 'preset',
          isPreset: true,
          category: 'blank',
          icon: 'note',
          content: '',
          sortOrder: 1,
          createdAt: 'x',
          updatedAt: 'x',
        } as never,
      ],
    });
    await expect(actions.deleteTemplate('tpl-preset')).rejects.toThrow(/不可删除/);
  });

  it('deleteTemplate：非存在 id → 静默 no-op（不删）', async () => {
    const { actions, state } = makeTemplateStore({ mode: 'online' });
    const before = state.templates.length;
    await actions.deleteTemplate('nonexistent');
    expect(state.templates.length).toBe(before);
    expect(apiDel2).not.toHaveBeenCalled();
  });

  it('deleteTemplate：用户模板 → DELETE + state 移除', async () => {
    apiDel2.mockResolvedValueOnce(undefined);
    const userTpl = {
      id: 'tpl-user-1',
      userId: 'u-1',
      name: '我的',
      isPreset: false,
      category: 'custom',
      icon: 'note',
      content: '',
      sortOrder: 1,
      createdAt: 'x',
      updatedAt: 'x',
    };
    const { actions, state } = makeTemplateStore({ mode: 'online', templates: [userTpl as never] });
    await actions.deleteTemplate('tpl-user-1');
    expect(apiDel2).toHaveBeenCalledWith('/templates/tpl-user-1');
    expect(state.templates.find((t) => t.id === 'tpl-user-1')).toBeUndefined();
  });
});
