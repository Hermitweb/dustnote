/**
 * web/src/lib/note-scope.batch.test.tsx - doBatchAction / batchAction 调用链 (Round 23)
 *
 * 直接调用 hook 返回的 doBatchAction / batchAction 触发 7 种批量操作
 * （delete / permdelete / restore / pin / unpin / fav / unfav）以及 confirm 路径。
 */
import { describe, it, vi, beforeEach, expect } from 'vitest';
import { installPolyfills } from '../test/polyfills';
import { render, act, createElement, cleanup } from '../test/render';
import type { NotePlaintext } from './store-types';

installPolyfills();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'zh-CN' },
  }),
}));

// mock 形参按生产 store action 的真实签名声明（见 slices/data-slice.ts）：
// 无参 mock 的 calls 元组长度为 0，取 c[0] / c[1] 会被判成 TS2493
const storeActions = vi.hoisted(() => ({
  deleteNote: vi.fn(async (_id: string) => undefined),
  restoreNote: vi.fn(async (_id: string) => undefined),
  permanentDeleteNote: vi.fn(async (_id: string) => undefined),
  updateNote: vi.fn(
    async (
      _id: string,
      _patch: Partial<NotePlaintext> & { isPinned?: boolean; isFavorite?: boolean }
    ) => undefined
  ),
  moveNote: vi.fn(async (_id: string, _folderId: string | null) => undefined),
}));

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
  // actions
  deleteNote: storeActions.deleteNote,
  restoreNote: storeActions.restoreNote,
  permanentDeleteNote: storeActions.permanentDeleteNote,
  updateNote: storeActions.updateNote,
  moveNote: storeActions.moveNote,
  loadAll: vi.fn(),
}));

vi.mock('./store', () => {
  const fn = (selector: (s: typeof storeState) => unknown) => selector(storeState);
  fn.getState = () => storeState;
  return { useStore: fn, getState: () => storeState };
});

vi.mock('./toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
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
function capture(): ReturnType<typeof useNoteScope> {
  return lastResult!;
}

beforeEach(() => {
  cleanup();
  storeActions.deleteNote.mockClear();
  storeActions.restoreNote.mockClear();
  storeActions.permanentDeleteNote.mockClear();
  storeActions.updateNote.mockClear();
  storeActions.moveNote.mockClear();
  storeState.loadAll.mockReset();
  storeState.loadAll.mockResolvedValue(undefined);
  // 用 makeNote 生成完整 NoteRow（含 serverUpdatedAt）
  storeState.notes = new Map([
    [
      'n1',
      {
        id: 'n1',
        ciphertext: '{}',
        keyVersion: 1,
        isPinned: false,
        isFavorite: false,
        deletedAt: null,
        version: 1,
        clientUpdatedAt: '2025-01-01T00:00:00.000Z',
        serverUpdatedAt: '2025-01-01T00:00:00.000Z',
        folderId: null,
      },
    ],
    [
      'n2',
      {
        id: 'n2',
        ciphertext: '{}',
        keyVersion: 1,
        isPinned: false,
        isFavorite: false,
        deletedAt: null,
        version: 1,
        clientUpdatedAt: '2025-01-02T00:00:00.000Z',
        serverUpdatedAt: '2025-01-02T00:00:00.000Z',
        folderId: null,
      },
    ],
    [
      'n3',
      {
        id: 'n3',
        ciphertext: '{}',
        keyVersion: 1,
        isPinned: false,
        isFavorite: false,
        deletedAt: null,
        version: 1,
        clientUpdatedAt: '2025-01-03T00:00:00.000Z',
        serverUpdatedAt: '2025-01-03T00:00:00.000Z',
        folderId: null,
      },
    ],
  ]);
});

describe('doBatchAction - 7 种 action', () => {
  it('action="delete" → 调 deleteNote（每个选中的 id 一次）', async () => {
    renderAndCapture();
    act(() => capture().selectAll());
    const ids = Array.from(capture().selectedIds);
    await act(async () => {
      await capture().doBatchAction('delete');
    });
    expect(storeActions.deleteNote).toHaveBeenCalledTimes(3);
    // 调用顺序与 selectedIds 的迭代顺序一致
    expect(storeActions.deleteNote.mock.calls.map((c) => c[0])).toEqual(ids);
  });

  it('action="permdelete" → 调 permanentDeleteNote', async () => {
    renderAndCapture();
    act(() => capture().selectAll());
    await act(async () => {
      await capture().doBatchAction('permdelete');
    });
    expect(storeActions.permanentDeleteNote).toHaveBeenCalledTimes(3);
    expect(storeActions.permanentDeleteNote).toHaveBeenCalledWith('n3');
  });

  it('action="restore" → 调 restoreNote', async () => {
    renderAndCapture();
    act(() => capture().selectAll());
    await act(async () => {
      await capture().doBatchAction('restore');
    });
    expect(storeActions.restoreNote).toHaveBeenCalledTimes(3);
    expect(storeActions.restoreNote).toHaveBeenCalledWith('n3');
  });

  it('action="pin" → 调 updateNote with { isPinned: true }', async () => {
    renderAndCapture();
    act(() => capture().selectAll());
    await act(async () => {
      await capture().doBatchAction('pin');
    });
    expect(storeActions.updateNote).toHaveBeenCalledTimes(3);
    expect(storeActions.updateNote.mock.calls[0]?.[1]).toEqual({ isPinned: true });
  });

  it('action="unpin" → 调 updateNote with { isPinned: false }', async () => {
    renderAndCapture();
    act(() => capture().selectAll());
    await act(async () => {
      await capture().doBatchAction('unpin');
    });
    expect(storeActions.updateNote.mock.calls[0]?.[1]).toEqual({ isPinned: false });
  });

  it('action="fav" → 调 updateNote with { isFavorite: true }', async () => {
    renderAndCapture();
    act(() => capture().selectAll());
    await act(async () => {
      await capture().doBatchAction('fav');
    });
    expect(storeActions.updateNote.mock.calls[0]?.[1]).toEqual({ isFavorite: true });
  });

  it('action="unfav" → 调 updateNote with { isFavorite: false }', async () => {
    renderAndCapture();
    act(() => capture().selectAll());
    await act(async () => {
      await capture().doBatchAction('unfav');
    });
    expect(storeActions.updateNote.mock.calls[0]?.[1]).toEqual({ isFavorite: false });
  });

  it('action="move" → 调 moveNote with targetFolderId', async () => {
    renderAndCapture();
    act(() => capture().selectAll());
    await act(async () => {
      await capture().doBatchAction('move', 'f-target');
    });
    expect(storeActions.moveNote).toHaveBeenCalledTimes(3);
    expect(storeActions.moveNote.mock.calls[0]?.[1]).toBe('f-target');
  });

  it('action="unknown" → continue（不调任何 action，ok 不增）', async () => {
    renderAndCapture();
    act(() => capture().selectAll());
    await act(async () => {
      await capture().doBatchAction('bogus');
    });
    expect(storeActions.deleteNote).not.toHaveBeenCalled();
    expect(storeActions.updateNote).not.toHaveBeenCalled();
    expect(storeActions.moveNote).not.toHaveBeenCalled();
  });

  it('selectedIds 为空 → 直接 return（不调任何 action）', async () => {
    renderAndCapture();
    // 不 selectAll
    await act(async () => {
      await capture().doBatchAction('delete');
    });
    expect(storeActions.deleteNote).not.toHaveBeenCalled();
  });

  it('action 抛错 → failed++ 但循环继续（其他 id 仍处理）', async () => {
    storeActions.deleteNote
      .mockRejectedValueOnce(new Error('fail-n3'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    renderAndCapture();
    act(() => capture().selectAll());
    await act(async () => {
      await capture().doBatchAction('delete');
    });
    // 3 次都调（失败也尝试）
    expect(storeActions.deleteNote).toHaveBeenCalledTimes(3);
    expect(storeActions.deleteNote).toHaveBeenNthCalledWith(1, 'n3');
  });
});

describe('batchAction - confirm 路径', () => {
  it('action="delete" → 设置 batchConfirmMsg + pendingBatchAction（不调 doBatchAction）', async () => {
    renderAndCapture();
    act(() => capture().selectAll());
    await act(async () => {
      await capture().batchAction('delete');
    });
    expect(capture().pendingBatchAction).toBe('delete');
    expect(capture().batchConfirmMsg).toMatch(/sidebar\.confirm_delete/);
    expect(storeActions.deleteNote).not.toHaveBeenCalled();
  });

  it('action="permdelete" → 设置 pendingBatchAction="permdelete" + confirm_permdelete 文案', async () => {
    renderAndCapture();
    act(() => capture().selectAll());
    await act(async () => {
      await capture().batchAction('permdelete');
    });
    expect(capture().pendingBatchAction).toBe('permdelete');
    expect(capture().batchConfirmMsg).toMatch(/sidebar\.confirm_permdelete/);
  });

  it('action="pin" → 跳过 confirm，直接调 doBatchAction', async () => {
    renderAndCapture();
    act(() => capture().selectAll());
    await act(async () => {
      await capture().batchAction('pin');
    });
    expect(capture().pendingBatchAction).toBeNull();
    expect(storeActions.updateNote).toHaveBeenCalledTimes(3);
  });

  it('action="move" → 跳过 confirm（不阻塞），调 doBatchAction', async () => {
    renderAndCapture();
    act(() => capture().selectAll());
    await act(async () => {
      await capture().batchAction('move', 'f-target');
    });
    expect(capture().pendingBatchAction).toBeNull();
    expect(storeActions.moveNote).toHaveBeenCalledTimes(3);
  });

  it('selectedIds 为空 → 直接 return（不设 pendingBatchAction）', async () => {
    renderAndCapture();
    // 不 selectAll
    await act(async () => {
      await capture().batchAction('delete');
    });
    expect(capture().pendingBatchAction).toBeNull();
  });
});
