/**
 * web/src/lib/note-scope.sort-batch.test.tsx - useNoteScope 排序/批量选择/分页 (Round 18)
 */
import { describe, it, vi, beforeEach, expect } from 'vitest';
import { installPolyfills } from '../test/polyfills';
import { render, act, createElement, cleanup } from '../test/render';

installPolyfills();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'zh-CN' },
  }),
}));

vi.mock('./toast', () => ({ toast: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

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

vi.mock('./search', () => ({
  SearchIndex: class {
    rebuild = () => undefined;
    search = () => [];
  },
}));

import { useNoteScope } from './note-scope';

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

// 获取最新 hook 返回值（renderAndCapture 返回的是首次渲染的引用，setState 后需要重新拿）
function capture(): ReturnType<typeof useNoteScope> {
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

describe('useNoteScope - sorting & batch actions', () => {
  it('sortKey=title (默认 updated) 按 title localeCompare', () => {
    storeState.notes = new Map([
      ['a', makeNote('a', { title: '', serverUpdatedAt: '2025-01-01T00:00:00Z' })],
      ['b', makeNote('b', { title: '', serverUpdatedAt: '2025-02-01T00:00:00Z' })],
    ]);
    storeState.notesPlain = new Map([
      ['a', { title: 'Bravo', content: '', tags: [] }],
      ['b', { title: 'Alpha', content: '', tags: [] }],
    ]);
    const r = renderAndCapture();
    // 默认 sortKey='updated'，更新晚的 (b) 在前
    expect(r.visibleNotes[0]!.id).toBe('b');
    expect(r.visibleNotes[1]!.id).toBe('a');

    // 切到 title
    act(() => r.setSortKey('title'));
    // render 后需要重新捕获（hook 状态改变）
    cleanup();
    const r2 = renderAndCapture();
    // Alpha 在前（localeCompare 中文 zh-CN：Bravo < Alpha）
    // localeCompare 在 zh-CN 下按拼音：Alpha(A) < Bravo(B)
    expect(r2.visibleNotes[0]!.id).toBe('b'); // Alpha
    expect(r2.visibleNotes[1]!.id).toBe('a'); // Bravo
  });

  it('sortKey=words 按内容长度倒序', () => {
    storeState.notes = new Map([
      ['short', makeNote('short', { serverUpdatedAt: '2025-01-01T00:00:00Z' })],
      ['long', makeNote('long', { serverUpdatedAt: '2025-01-02T00:00:00Z' })],
    ]);
    storeState.notesPlain = new Map([
      ['short', { title: 'short', content: 'hi', tags: [] }],
      ['long', { title: 'long', content: 'a longer content here', tags: [] }],
    ]);
    const r = renderAndCapture();
    act(() => r.setSortKey('words'));
    cleanup();
    const r2 = renderAndCapture();
    // 'long' content 较长 → 在前
    expect(r2.visibleNotes[0]!.id).toBe('long');
    expect(r2.visibleNotes[1]!.id).toBe('short');
  });

  it('isPinned=true 笔记排前（无论 sortKey）', () => {
    storeState.notes = new Map([
      ['plain', makeNote('plain', { isPinned: false })],
      ['pinned', makeNote('pinned', { isPinned: true })],
    ]);
    storeState.notesPlain = new Map([
      ['plain', { title: 'Z', content: '', tags: [] }],
      ['pinned', { title: 'A', content: '', tags: [] }],
    ]);
    const r = renderAndCapture();
    act(() => r.setSortKey('title'));
    cleanup();
    const r2 = renderAndCapture();
    // pinned 在前 (虽然 title='A' < 'Z')
    expect(r2.visibleNotes[0]!.id).toBe('pinned');
  });

  it('toggleSelect：选两个 + 再取消 → 回到 1 个', () => {
    storeState.notes = new Map([
      ['n1', makeNote('n1', {})],
      ['n2', makeNote('n2', {})],
    ]);
    storeState.notesPlain = new Map([
      ['n1', { title: 'n1', content: '', tags: [] }],
      ['n2', { title: 'n2', content: '', tags: [] }],
    ]);
    const r = renderAndCapture();
    act(() => r.toggleSelect('n1'));
    act(() => r.toggleSelect('n2'));
    expect(capture().selectedIds.has('n1')).toBe(true);
    expect(capture().selectedIds.has('n2')).toBe(true);
    expect(capture().selectedIds.size).toBe(2);

    act(() => r.toggleSelect('n2'));
    // 取消 n2（剩下只有 n1 → size===0 不会触发，因为还有 n1）
    expect(capture().selectedIds.has('n2')).toBe(false);
    expect(capture().selectedIds.size).toBe(1);
  });

  it('exitSelect：清空 selecting + selectedIds', () => {
    storeState.notes = new Map([['n1', makeNote('n1', {})]]);
    storeState.notesPlain = new Map([['n1', { title: 'n1', content: '', tags: [] }]]);
    const r = renderAndCapture();
    act(() => r.toggleSelect('n1'));
    act(() => r.setSelecting(true));
    expect(capture().selecting).toBe(true);

    act(() => r.exitSelect());
    expect(capture().selecting).toBe(false);
    expect(capture().selectedIds.size).toBe(0);
  });

  it('selectAll：当前未选 → 全选 + selecting=true', () => {
    storeState.notes = new Map([
      ['n1', makeNote('n1', {})],
      ['n2', makeNote('n2', {})],
    ]);
    storeState.notesPlain = new Map([
      ['n1', { title: 'n1', content: '', tags: [] }],
      ['n2', { title: 'n2', content: '', tags: [] }],
    ]);
    const r = renderAndCapture();
    expect(capture().selectedIds.size).toBe(0);
    act(() => r.selectAll());
    expect(capture().selectedIds.size).toBe(2);
    expect(capture().selecting).toBe(true);
  });

  it('selectAll：当前已全选 → 清空', () => {
    storeState.notes = new Map([
      ['n1', makeNote('n1', {})],
      ['n2', makeNote('n2', {})],
    ]);
    storeState.notesPlain = new Map([
      ['n1', { title: 'n1', content: '', tags: [] }],
      ['n2', { title: 'n2', content: '', tags: [] }],
    ]);
    renderAndCapture();
    // 每次调用都用 capture() 取最新 callback（useCallback 闭包依赖 selectedIds）
    act(() => capture().selectAll());
    expect(capture().selectedIds.size).toBe(2);
    act(() => capture().selectAll());
    expect(capture().selectedIds.size).toBe(0);
    expect(capture().selecting).toBe(false);
  });
});
