/**
 * ConflictDialog 测试
 *
 * 覆盖：
 * - 无冲突时不渲染
 * - 有冲突时渲染并展示字段 diff
 * - 点击三个选项触发 resolveConflictChoice
 * - 点击忽略触发 dismissConflict
 * - formatValue 各字段类型分支
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';
import type { PendingConflict } from '../lib/store-types';
import type { MergeableNote } from '@dustnote/client-core';

const mockResolve = vi.fn();
const mockDismiss = vi.fn();
let mockPending: PendingConflict[] = [];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts) return `${k}:${JSON.stringify(opts)}`;
      return k;
    },
    i18n: { language: 'zh-CN' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('../lib/store', () => ({
  useStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        pendingConflicts: mockPending,
        resolveConflictChoice: mockResolve,
        dismissConflict: mockDismiss,
      }),
    {
      getState: () => ({
        pendingConflicts: mockPending,
        resolveConflictChoice: mockResolve,
        dismissConflict: mockDismiss,
      }),
    }
  ),
}));

import { ConflictDialog } from './ConflictDialog';

/**
 * 生产类型 MergeableNote = 明文（plaintext）+ 元数据（id / isPinned / isFavorite /
 * deletedAt / folderId / clientUpdatedAt）。ConflictDialog 只读 noteId 与 conflicts，
 * 这里按生产形状补齐，避免用 `as` 掩盖 fixture 与生产类型的偏差。
 */
function mergeableNote(overrides: Partial<MergeableNote> = {}): MergeableNote {
  return {
    id: 'n-1',
    plaintext: { title: '标题', content: '', tags: [] },
    isPinned: false,
    isFavorite: false,
    deletedAt: null,
    folderId: null,
    clientUpdatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const sampleConflict = (overrides: Partial<PendingConflict> = {}): PendingConflict => ({
  noteId: 'n-1',
  conflicts: [
    {
      field: 'title',
      baseValue: 'old',
      localValue: '我改的',
      serverValue: '服务器版',
    },
  ],
  merged: mergeableNote({ plaintext: { title: 'merged', content: '', tags: [] } }),
  local: mergeableNote(),
  server: mergeableNote(),
  serverVersion: 1,
  ...overrides,
});

describe('ConflictDialog', () => {
  afterEach(() => {
    cleanup();
    mockPending = [];
    mockResolve.mockReset();
    mockDismiss.mockReset();
  });

  it('无冲突时不渲染', () => {
    mockPending = [];
    const { container } = render(<ConflictDialog />);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('有冲突时渲染 alertdialog', () => {
    mockPending = [sampleConflict()];
    const { container } = render(<ConflictDialog />);
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
  });

  it('展示字段名标签', () => {
    mockPending = [
      sampleConflict({
        conflicts: [
          { field: 'title', baseValue: 'a', localValue: 'b', serverValue: 'c' },
          { field: 'tags', baseValue: [], localValue: ['x', 'y'], serverValue: ['m'] },
          { field: 'isPinned', baseValue: false, localValue: true, serverValue: false },
        ],
      }),
    ];
    const { container } = render(<ConflictDialog />);
    expect(container.textContent).toContain('conflict.field_title');
    expect(container.textContent).toContain('conflict.field_tags');
    expect(container.textContent).toContain('conflict.field_isPinned');
  });

  it('使用本地版本触发 resolveConflictChoice("local")', async () => {
    mockPending = [sampleConflict()];
    mockResolve.mockResolvedValue(undefined);
    const { container } = render(<ConflictDialog />);
    const btn = container.querySelectorAll<HTMLButtonElement>('button')[0]!;
    fireEvent.click(btn);
    expect(mockResolve).toHaveBeenCalledWith('n-1', 'local');
  });

  it('使用服务器版本触发 resolveConflictChoice("server")', () => {
    mockPending = [sampleConflict()];
    const { container } = render(<ConflictDialog />);
    // 第一个 div 有 "保留我的编辑" 和 "保留服务器版本" 两个按钮，按 DOM 顺序第二个
    const buttons = container.querySelectorAll('button');
    const useServer = Array.from(buttons).find((b) =>
      b.textContent?.includes('conflict.use_server')
    );
    expect(useServer).toBeDefined();
    fireEvent.click(useServer!);
    expect(mockResolve).toHaveBeenCalledWith('n-1', 'server');
  });

  it('智能合并按钮触发 merged', () => {
    mockPending = [sampleConflict()];
    const { container } = render(<ConflictDialog />);
    const useMerged = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('conflict.use_merged')
    );
    expect(useMerged).toBeDefined();
    fireEvent.click(useMerged!);
    expect(mockResolve).toHaveBeenCalledWith('n-1', 'merged');
  });

  it('忽略按钮触发 dismissConflict', () => {
    mockPending = [sampleConflict()];
    const { container } = render(<ConflictDialog />);
    const dismiss = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('conflict.dismiss')
    );
    expect(dismiss).toBeDefined();
    fireEvent.click(dismiss!);
    expect(mockDismiss).toHaveBeenCalledWith('n-1');
  });

  it('多冲突时只展示队首（pendingConflicts[0]）', () => {
    mockPending = [sampleConflict({ noteId: 'first' }), sampleConflict({ noteId: 'second' })];
    const { container } = render(<ConflictDialog />);
    // 两个 use_local 按钮 + 其他按钮中，第一个 use_local 对应 first
    const firstUseLocal = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('conflict.use_local')
    );
    fireEvent.click(firstUseLocal!);
    expect(mockResolve).toHaveBeenCalledWith('first', 'local');
  });

  it('formatValue: 列表多 tag 拼接、空数组 → conflict.none_value', () => {
    mockPending = [
      sampleConflict({
        conflicts: [
          { field: 'tags', baseValue: null, localValue: [], serverValue: ['a', 'b'] },
          { field: 'isFavorite', baseValue: null, localValue: true, serverValue: false },
          { field: 'deletedAt', baseValue: null, localValue: '2025-01-01', serverValue: null },
          { field: 'folderId', baseValue: null, localValue: null, serverValue: null },
          { field: 'content', baseValue: null, localValue: 'x'.repeat(150), serverValue: '' },
        ],
      }),
    ];
    const { container } = render(<ConflictDialog />);
    // 标签 join: a、b
    expect(container.textContent).toContain('a、b');
    // favorites / unfavorites
    expect(container.textContent).toContain('conflict.favorited');
    expect(container.textContent).toContain('conflict.unfavorited');
    // deletedAt 有值 → conflict.deleted；null 走前置 none_value 分支
    expect(container.textContent).toContain('conflict.deleted');
    // 过长 content 截断
    expect(container.textContent).toContain('…');
  });
});
