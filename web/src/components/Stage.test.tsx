/**
 * 舞台路由测试（UI 阶段 2.8）
 *
 * Editor / Overview / NoteList / StageHead 桩成占位元素：这里要验的是
 * 「哪种 store 事实落到哪一态」以及 Esc 的回退行为，不是它们内部长什么样。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, createElement } from '../test/render';

const state = vi.hoisted(() => ({
  viewMode: 'overview' as string,
  searchQuery: '',
  selectedNoteId: null as string | null,
  selectedFolderId: null as string | null,
  selectedTag: null as string | null,
  setSearchQuery: vi.fn((q: string) => void (state.searchQuery = q)),
  selectNote: vi.fn((id: string | null) => void (state.selectedNoteId = id)),
  selectFolder: vi.fn((id: string | null) => {
    state.selectedFolderId = id;
    state.viewMode = 'all';
  }),
  setSelectedTag: vi.fn((t: string | null) => {
    state.selectedTag = t;
    if (t) {
      state.selectedNoteId = null;
      state.selectedFolderId = null;
      state.viewMode = 'all';
    }
  }),
  setViewMode: vi.fn((m: string) => {
    state.viewMode = m;
    state.selectedFolderId = null;
    state.selectedNoteId = null;
  }),
}));

vi.mock('../lib/store', () => ({
  useStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
    getState: () => state,
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('./Editor', () => ({ Editor: () => createElement('div', { 'data-stub': 'editor' }) }));
vi.mock('./Overview', () => ({
  Overview: () => createElement('div', { 'data-stub': 'overview' }),
}));
vi.mock('./NoteList', () => ({
  NoteList: () => createElement('div', { 'data-stub': 'notelist' }),
}));
vi.mock('./StageHead', () => ({
  StageHead: () => createElement('div', { 'data-stub': 'stagehead' }),
}));

const mount = async () => {
  const { Stage } = await import('./Stage');
  return render(createElement(Stage));
};
const stub = (which: string) => document.querySelector(`[data-stub="${which}"]`);

describe('Stage 舞台路由', () => {
  beforeEach(() => {
    state.viewMode = 'overview';
    state.searchQuery = '';
    state.selectedNoteId = null;
    state.selectedFolderId = null;
    state.selectedTag = null;
    state.setSearchQuery.mockClear();
    state.selectNote.mockClear();
    state.selectFolder.mockClear();
    state.setViewMode.mockClear();
  });
  afterEach(() => cleanup());

  it('首屏落到概览，而不是空白页', async () => {
    await mount();
    expect(stub('overview')).not.toBeNull();
    expect(stub('editor')).toBeNull();
  });

  it('目的地是「全部笔记」→ 列表态（两栏改造后列表就是舞台本身）', async () => {
    state.viewMode = 'all';
    await mount();
    expect(stub('notelist')).not.toBeNull();
    expect(stub('overview')).toBeNull();
  });

  it('选中笔记落到详情，并带上舞台头部', async () => {
    state.selectedNoteId = 'n-1';
    await mount();
    expect(stub('editor')).not.toBeNull();
    expect(stub('stagehead')).not.toBeNull();
  });

  it('详情压过搜索：查询词还在框里也先看到正文', async () => {
    state.viewMode = 'all';
    state.selectedNoteId = 'n-1';
    state.searchQuery = '密钥';
    await mount();
    expect(stub('editor')).not.toBeNull();
    expect(stub('notelist')).toBeNull();
  });

  it('有查询词、没打开笔记 → 搜索态也走列表体', async () => {
    state.viewMode = 'all';
    state.searchQuery = '密钥';
    await mount();
    expect(stub('notelist')).not.toBeNull();
  });

  it('收藏 / 回收站 → 列表态', async () => {
    state.viewMode = 'trash';
    await mount();
    expect(stub('notelist')).not.toBeNull();
  });

  it('Esc 在详情态先关正文，查询词留着（下一步才清）', async () => {
    state.viewMode = 'all';
    state.selectedNoteId = 'n-1';
    state.searchQuery = '密钥';
    await mount();
    fireEvent.keyDown(window, 'Escape');
    expect(state.selectNote).toHaveBeenCalledWith(null);
    expect(state.setSearchQuery).not.toHaveBeenCalled();
  });

  it('Esc 在搜索态先清查询词，不动选中项', async () => {
    state.viewMode = 'all';
    state.searchQuery = '密钥';
    await mount();
    fireEvent.keyDown(window, 'Escape');
    expect(state.setSearchQuery).toHaveBeenCalledWith('');
    expect(state.selectNote).not.toHaveBeenCalled();
  });

  it('Esc 在收藏视图回到「全部笔记」根列表', async () => {
    state.viewMode = 'favorites';
    await mount();
    fireEvent.keyDown(window, 'Escape');
    expect(state.selectFolder).toHaveBeenCalledWith(null);
  });

  it('Esc 在「全部笔记」根列表是终点：按 Esc 不该把人扔到概览页', async () => {
    state.viewMode = 'all';
    await mount();
    fireEvent.keyDown(window, 'Escape');
    expect(state.setViewMode).not.toHaveBeenCalled();
    expect(state.selectFolder).not.toHaveBeenCalled();
  });

  it('Esc 在概览是终点，不再乱跳', async () => {
    await mount();
    fireEvent.keyDown(window, 'Escape');
    expect(state.setViewMode).not.toHaveBeenCalled();
    expect(state.selectNote).not.toHaveBeenCalled();
  });

  it('弹窗打开时不抢 Esc，交给弹窗自己处理', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    state.selectedNoteId = 'n-1';
    await mount();
    fireEvent.keyDown(window, 'Escape');
    expect(state.selectNote).not.toHaveBeenCalled();
    dialog.remove();
  });

  it('焦点在输入框里时不抢 Esc', async () => {
    state.selectedNoteId = 'n-1';
    const { container } = await mount();
    const input = document.createElement('input');
    container.appendChild(input);
    fireEvent.keyDown(input, 'Escape');
    expect(state.selectNote).not.toHaveBeenCalled();
  });

  it('标签范围：目的地还停在概览，舞台也应是列表态，且 Esc 先退标签', async () => {
    state.selectedTag = '工作';
    await mount();
    expect(stub('notelist')).not.toBeNull();
    expect(stub('overview')).toBeNull();
    fireEvent.keyDown(window, 'Escape');
    expect(state.setSelectedTag).toHaveBeenCalledWith(null);
  });

  it('舞台不渲染 main：#main-content 由 App 唯一持有，跳转链接落点确定', async () => {
    await mount();
    expect(document.querySelector('main')).toBeNull();
  });
});
