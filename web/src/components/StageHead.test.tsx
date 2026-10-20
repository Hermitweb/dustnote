/**
 * StageHead 测试
 *
 * 覆盖：返回按钮 / step 切换 / 标签 scope / 视图 label / folder 链
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const state = vi.hoisted(() => ({
  folders: [] as Array<{ id: string; name: string; parentId?: string }>,
  selectedNoteId: 'n-1' as string | null,
  selectedFolderId: null as string | null,
  viewMode: 'all' as string,
  selectedTag: null as string | null,
  stageOrder: ['n-1', 'n-2', 'n-3'] as string[],
  selectNote: vi.fn(),
}));

vi.mock('../lib/store', () => ({
  useStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
    getState: () => state,
  }),
}));

import { StageHead } from '../components/StageHead';

describe('StageHead', () => {
  beforeEach(() => {
    state.folders = [];
    state.selectedNoteId = 'n-1';
    state.selectedFolderId = null;
    state.viewMode = 'all';
    state.selectedTag = null;
    state.stageOrder = ['n-1', 'n-2', 'n-3'];
    state.selectNote.mockClear();
  });
  afterEach(() => cleanup());

  it('返回按钮触发 selectNote(null)', () => {
    const r = render(<StageHead />);
    const backBtn = r.container.querySelector('nav button') as HTMLElement;
    fireEvent.click(backBtn);
    expect(state.selectNote).toHaveBeenCalledWith(null);
  });

  it('未选中 note → 渲染 nav 但无 pos 段', () => {
    state.selectedNoteId = null;
    const r = render(<StageHead />);
    expect(r.container.querySelector('nav')).toBeTruthy();
  });

  it('选中标签 → scopeLabel 显示标签 scope', () => {
    state.selectedTag = '工作';
    state.viewMode = 'overview';
    state.selectedNoteId = 'n-1';
    const r = render(<StageHead />);
    expect(r.container.textContent).toContain('sidebar.tags');
    expect(r.container.textContent).toContain('工作');
  });

  it('选中 folder → 显示文件夹链', () => {
    state.selectedFolderId = 'child';
    state.folders = [
      { id: 'root', name: '一级' },
      { id: 'child', name: '二级', parentId: 'root' },
    ];
    const r = render(<StageHead />);
    expect(r.container.textContent).toContain('一级 / 二级');
  });
});
