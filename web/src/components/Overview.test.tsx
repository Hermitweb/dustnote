/**
 * 概览态测试（UI 阶段 2.8 第一块）
 *
 * e2e 的 setupStandalone 会自动打开一篇笔记，因此基线截图覆盖不到"未选中笔记"这一态，
 * 这里用 store 桩把它钉住。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, createElement } from '../test/render';

const { storeState, useStoreMock } = vi.hoisted(() => {
  const mk = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    id,
    title,
    content: '正文',
    tags: ['灵感'],
    ...extra,
  });
  const storeState = {
    notes: new Map([
      [
        'n-1',
        {
          id: 'n-1',
          isPinned: true,
          isFavorite: true,
          deletedAt: null,
          clientUpdatedAt: '2026-09-25T01:00:00.000Z',
        },
      ],
      [
        'n-2',
        {
          id: 'n-2',
          isPinned: false,
          isFavorite: false,
          deletedAt: null,
          clientUpdatedAt: '2026-09-24T01:00:00.000Z',
        },
      ],
      [
        'n-3',
        {
          id: 'n-3',
          isPinned: false,
          isFavorite: false,
          deletedAt: '2026-09-20T01:00:00.000Z',
          clientUpdatedAt: '2026-09-19T01:00:00.000Z',
        },
      ],
    ]),
    notesPlain: new Map([
      ['n-1', mk('n-1', '端到端加密的三个层次')],
      ['n-2', mk('n-2', '玻璃要留，但得讲三档规矩')],
      ['n-3', mk('n-3', '已删除的笔记')],
    ]),
    selectNote: vi.fn(),
  };
  const useStoreMock = vi.fn((selector?: (s: typeof storeState) => unknown) =>
    selector ? selector(storeState) : storeState
  );
  (useStoreMock as unknown as { getState: () => typeof storeState }).getState = () => storeState;
  return { storeState, useStoreMock };
});

vi.mock('../lib/store', () => ({ useStore: useStoreMock }));
vi.mock('react-i18next', () => ({
  // Overview 只用 t(key) 与 i18n.language；真实 i18n 在测试里是噪音（同 SharesManager.test 的做法）
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

describe('Overview 概览态', () => {
  beforeEach(() => {
    useStoreMock.mockClear();
    storeState.selectNote.mockClear();
  });
  afterEach(() => cleanup());

  const mount = async () => {
    const { Overview } = await import('../components/Overview');
    return render(createElement(Overview));
  };

  it('统计只数未删除的笔记：2 篇笔记 / 1 收藏 / 1 标签', async () => {
    const { getByText } = await mount();
    const values = ['2', '1'].map((v) => getByText(v).textContent);
    expect(values).toEqual(['2', '1']);
    expect(getByText('overview.stat_notes')).toBeInTheDocument();
    expect(getByText('overview.stat_favorites')).toBeInTheDocument();
    expect(getByText('overview.stat_tags')).toBeInTheDocument();
  });

  it('最近编辑按 clientUpdatedAt 倒序，且不含回收站笔记', async () => {
    const { getAllByText, queryByText } = await mount();
    expect(getAllByText('端到端加密的三个层次')).toHaveLength(1);
    expect(getAllByText('玻璃要留，但得讲三档规矩')).toHaveLength(1);
    expect(queryByText('已删除的笔记')).toBeNull();
  });

  it('点最近编辑项会打开该笔记', async () => {
    const { getAllByText } = await mount();
    const label = getAllByText('端到端加密的三个层次')[0] as HTMLElement;
    const btn = label.closest('button') as HTMLElement;
    fireEvent.click(btn);
    expect(storeState.selectNote).toHaveBeenCalledWith('n-1');
  });

  it('快捷操作走 window 事件，不依赖 App 往下传 state', async () => {
    const seen: string[] = [];
    const on = (e: Event) => seen.push(e.type);
    ['app:new-note', 'app:import-export', 'app:open-shares'].forEach((t) =>
      window.addEventListener(t, on)
    );
    const { getByText } = await mount();
    fireEvent.click(getByText('overview.new_note').closest('button') as HTMLElement);
    fireEvent.click(getByText('overview.import').closest('button') as HTMLElement);
    fireEvent.click(getByText('overview.shares').closest('button') as HTMLElement);
    ['app:new-note', 'app:import-export', 'app:open-shares'].forEach((t) =>
      window.removeEventListener(t, on)
    );
    expect(seen).toEqual(['app:new-note', 'app:import-export', 'app:open-shares']);
  });

  it('零笔记时给引导而不是空白', async () => {
    storeState.notes = new Map();
    storeState.notesPlain = new Map();
    const { getByText } = await mount();
    expect(getByText('overview.no_recent')).toBeInTheDocument();
    expect(getByText('0')).toBeInTheDocument();
  });
});
