/**
 * web/src/lib/note-scope.test.tsx - useNoteScope hook unit tests
 *
 * useNoteScope 是 NoteList 的唯一消费者，返回有序可见笔记集 + 导航选择态。
 * 输入维度（彼此正交）：
 *   - viewMode: 'all' | 'favorites' | 'trash'
 *   - selectedFolderId（含子后代）/ UNFILED_ID
 *   - selectedTag
 *   - searchQuery（E2EE 下客户端建索引）
 *   - sortKey: 'updated' | 'title' | 'words'
 *
 * 测试策略：用 Probe 组件在首次渲染时调用 hook 并把返回值挂到全局变量，
 * 再断言返回值。store 用共享 storeState 对象，useStore 接受 selector 函数。
 */
import { describe, it, vi, beforeEach, expect } from 'vitest';
import { installPolyfills } from '../test/polyfills';
import { render, createElement, cleanup } from '../test/render';

installPolyfills();

// mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'zh-CN' },
  }),
}));

// mock toast
vi.mock('./toast', () => ({ toast: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

// mock shared: noteAad 仅产出 Uint8Array
vi.mock('@dustnote/shared', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dustnote/shared');
  return actual;
});

// mock store with useStore(selector) pattern
const storeState = vi.hoisted(() => ({
  notes: new Map<string, Record<string, unknown>>(),
  notesPlain: new Map<string, { title: string; content: string; tags: string[] }>(),
  folders: [] as Array<{ id: string; parentId: string | null; name: string; depth?: number }>,
  selectedFolderId: null as string | null,
  selectedNoteId: null as string | null,
  viewMode: 'all' as 'all' | 'favorites' | 'trash',
  selectedTag: null as string | null,
  searchQuery: '',
  setSearchQuery: vi.fn(),
  setStageOrder: vi.fn(),
  selectNote: vi.fn(),
  selectFolder: vi.fn(),
  setViewMode: vi.fn(),
  deleteNote: vi.fn(),
  restoreNote: vi.fn(),
  permanentDeleteNote: vi.fn(),
  updateNote: vi.fn(),
  moveNote: vi.fn(),
}));

vi.mock('./store', () => ({
  useStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

// mock SearchIndex (E2EE 下客户端建索引)
vi.mock('./search', () => ({
  SearchIndex: class {
    rebuild = () => undefined;
    search = (q: string) => {
      const hits = [];
      for (const [id, pt] of storeState.notesPlain) {
        if (pt.title.includes(q) || pt.content.includes(q)) {
          hits.push({ noteId: id, matchedTokens: new Set([q]) });
        }
      }
      return hits;
    };
  },
}));

import { useNoteScope } from './note-scope';
import { UNFILED_ID } from './store-types';

let lastResult: ReturnType<typeof useNoteScope> | undefined;

function renderAndCapture(): ReturnType<typeof useNoteScope> {
  lastResult = undefined;
  function Probe() {
    lastResult = useNoteScope();
    return null;
  }
  render(createElement(Probe));
  return lastResult!;
}

function makeNote(
  id: string,
  opts: Partial<{
    folderId: string | null;
    isPinned: boolean;
    isFavorite: boolean;
    deletedAt: string | null;
    title: string;
    content: string;
    tags: string[];
    serverUpdatedAt: string;
  }> = {}
) {
  return {
    id,
    ciphertext: '{}',
    keyVersion: 1,
    isPinned: opts.isPinned ?? false,
    isFavorite: opts.isFavorite ?? false,
    deletedAt: opts.deletedAt ?? null,
    version: 1,
    clientUpdatedAt: opts.serverUpdatedAt ?? '2025-01-01T00:00:00.000Z',
    serverUpdatedAt: opts.serverUpdatedAt ?? '2025-01-01T00:00:00.000Z',
    folderId: opts.folderId ?? null,
  };
}

beforeEach(() => {
  cleanup();
  storeState.notes = new Map();
  storeState.notesPlain = new Map();
  storeState.folders = [];
  storeState.selectedFolderId = null;
  storeState.selectedNoteId = null;
  storeState.viewMode = 'all';
  storeState.selectedTag = null;
  storeState.searchQuery = '';
  storeState.setSearchQuery.mockClear();
  storeState.setStageOrder.mockClear();
  storeState.selectNote.mockClear();
  storeState.selectFolder.mockClear();
  storeState.setViewMode.mockClear();
  storeState.deleteNote.mockClear();
  storeState.restoreNote.mockClear();
  storeState.permanentDeleteNote.mockClear();
  storeState.updateNote.mockClear();
  storeState.moveNote.mockClear();
});

describe('useNoteScope', () => {
  describe('viewMode 分支', () => {
    it('viewMode=all + 无 folder/tag/search -> 仅按 deletedAt 过滤的笔记', () => {
      storeState.notes = new Map([
        ['n1', makeNote('n1', {})],
        ['n2', makeNote('n2', {})],
        ['n-deleted', makeNote('n-deleted', { deletedAt: '2025-02-01T00:00:00Z' })],
      ]);
      storeState.notesPlain = new Map([
        ['n1', { title: 'n1', content: '', tags: [] }],
        ['n2', { title: 'n2', content: '', tags: [] }],
      ]);
      const r = renderAndCapture();
      expect(r.visibleNotes.length).toBe(2);
      expect(r.visibleNotes.find((n) => n.id === 'n-deleted')).toBeUndefined();
    });

    it('viewMode=favorites -> 仅 isFavorite=true 且非删除', () => {
      storeState.viewMode = 'favorites';
      storeState.notes = new Map([
        ['n1', makeNote('n1', {})],
        ['n2', makeNote('n2', { isFavorite: true })],
        ['n3', makeNote('n3', { isFavorite: true, deletedAt: '2025-02-01T00:00:00Z' })],
      ]);
      storeState.notesPlain = new Map([
        ['n1', { title: 'n1', content: '', tags: [] }],
        ['n2', { title: 'n2', content: '', tags: [] }],
        ['n3', { title: 'n3', content: '', tags: [] }],
      ]);
      const r = renderAndCapture();
      expect(r.visibleNotes.length).toBe(1);
      expect(r.visibleNotes[0]!.id).toBe('n2');
    });

    it('viewMode=trash -> 仅 deletedAt 非空', () => {
      storeState.viewMode = 'trash';
      storeState.notes = new Map([
        ['n1', makeNote('n1', {})],
        ['n2', makeNote('n2', { deletedAt: '2025-01-05T00:00:00Z' })],
      ]);
      storeState.notesPlain = new Map([
        ['n1', { title: 'n1', content: '', tags: [] }],
        ['n2', { title: 'n2', content: '', tags: [] }],
      ]);
      const r = renderAndCapture();
      expect(r.visibleNotes.length).toBe(1);
      expect(r.visibleNotes[0]!.id).toBe('n2');
    });
  });

  describe('folderScope 分支', () => {
    it('selectedFolderId + 后代 -> 范围内含所有后代', () => {
      storeState.selectedFolderId = 'f1';
      storeState.folders = [
        { id: 'f1', parentId: null, name: 'P', depth: 1 },
        { id: 'f2', parentId: 'f1', name: 'C1', depth: 2 },
        { id: 'f3', parentId: 'f1', name: 'C2', depth: 2 },
        { id: 'f4', parentId: null, name: 'Other', depth: 1 },
        { id: 'f5', parentId: 'f2', name: 'GC', depth: 3 },
      ];
      storeState.notes = new Map([
        ['n-in-f1', makeNote('n-in-f1', { folderId: 'f1' })],
        ['n-in-f2', makeNote('n-in-f2', { folderId: 'f2' })],
        ['n-in-f3', makeNote('n-in-f3', { folderId: 'f3' })],
        ['n-in-f5', makeNote('n-in-f5', { folderId: 'f5' })],
        ['n-in-f4', makeNote('n-in-f4', { folderId: 'f4' })],
        ['n-unfiled', makeNote('n-unfiled', {})],
      ]);
      storeState.notesPlain = new Map([
        ['n-in-f1', { title: 'a', content: '', tags: [] }],
        ['n-in-f2', { title: 'b', content: '', tags: [] }],
        ['n-in-f3', { title: 'c', content: '', tags: [] }],
        ['n-in-f5', { title: 'd', content: '', tags: [] }],
        ['n-in-f4', { title: 'e', content: '', tags: [] }],
        ['n-unfiled', { title: 'f', content: '', tags: [] }],
      ]);
      const r = renderAndCapture();
      const ids = r.visibleNotes.map((n) => n.id).sort();
      expect(ids).toEqual(['n-in-f1', 'n-in-f2', 'n-in-f3', 'n-in-f5']);
    });

    it('selectedFolderId = UNFILED_ID -> 仅 folderId=null 的笔记', () => {
      storeState.selectedFolderId = UNFILED_ID;
      storeState.notes = new Map([
        ['n-unfiled', makeNote('n-unfiled', {})],
        ['n-in-f1', makeNote('n-in-f1', { folderId: 'f1' })],
      ]);
      storeState.notesPlain = new Map([
        ['n-unfiled', { title: 'u', content: '', tags: [] }],
        ['n-in-f1', { title: 'i', content: '', tags: [] }],
      ]);
      const r = renderAndCapture();
      expect(r.visibleNotes.length).toBe(1);
      expect(r.visibleNotes[0]!.id).toBe('n-unfiled');
    });
  });

  describe('selectedTag 分支', () => {
    it('selectedTag=urgent -> 仅 tags 包含 urgent 的笔记', () => {
      storeState.selectedTag = 'urgent';
      storeState.notes = new Map([
        ['n1', makeNote('n1', {})],
        ['n2', makeNote('n2', {})],
      ]);
      storeState.notesPlain = new Map([
        ['n1', { title: 'n1', content: '', tags: ['urgent'] }],
        ['n2', { title: 'n2', content: '', tags: ['normal'] }],
      ]);
      const r = renderAndCapture();
      expect(r.visibleNotes.length).toBe(1);
      expect(r.visibleNotes[0]!.id).toBe('n1');
    });
  });

  describe('searchQuery 分支', () => {
    it('搜索命中 -> searchHits 包含命中 token', () => {
      storeState.searchQuery = 'hello';
      storeState.notes = new Map([
        ['n1', makeNote('n1', {})],
        ['n2', makeNote('n2', {})],
      ]);
      storeState.notesPlain = new Map([
        ['n1', { title: 'hello world', content: '', tags: [] }],
        ['n2', { title: 'bravo', content: '', tags: [] }],
      ]);
      const r = renderAndCapture();
      expect(r.searchHits.has('n1')).toBe(true);
      expect(r.searchHits.has('n2')).toBe(false);
    });
  });

  describe('排序与列表计数', () => {
    it('unfiledCount/trashCount 反映未分类和回收站笔记数', () => {
      storeState.notes = new Map([
        ['n1', makeNote('n1', {})],
        ['n2', makeNote('n2', {})],
        ['n3', makeNote('n3', { deletedAt: '2025-02-01T00:00:00Z' })],
        ['n4', makeNote('n4', {})],
      ]);
      storeState.notesPlain = new Map([
        ['n1', { title: 'n1', content: '', tags: [] }],
        ['n2', { title: 'n2', content: '', tags: [] }],
        ['n3', { title: 'n3', content: '', tags: [] }],
        ['n4', { title: 'n4', content: '', tags: [] }],
      ]);
      const r = renderAndCapture();
      expect(r.unfiledCount).toBe(3); // n1, n2, n4 都是 folderId=null
      expect(r.trashCount).toBe(1);
    });
  });
});
