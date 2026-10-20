/**
 * ScopeTitle 测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const state = vi.hoisted(() => ({
  viewMode: 'overview' as string,
  selectedFolderId: null as string | null,
  folders: [] as Array<{ id: string; name: string }>,
}));

vi.mock('../lib/store', () => ({
  useStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
    getState: () => state,
  }),
}));

import { ScopeTitle } from '../components/ScopeTitle';

describe('ScopeTitle', () => {
  beforeEach(() => {
    state.viewMode = 'overview';
    state.selectedFolderId = null;
    state.folders = [];
  });
  afterEach(() => cleanup());

  it('渲染根节点 + aria-live', () => {
    const r = render(<ScopeTitle />);
    const el = r.container.querySelector('[data-scope-title]') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.getAttribute('aria-live')).toBe('polite');
  });

  it('viewMode=overview → sidebar.overview label', () => {
    state.viewMode = 'overview';
    const r = render(<ScopeTitle />);
    expect(r.container.textContent).toContain('sidebar.overview');
  });

  it('viewMode=all → sidebar.all', () => {
    state.viewMode = 'all';
    const r = render(<ScopeTitle />);
    expect(r.container.textContent).toContain('sidebar.all');
  });

  it('viewMode=favorites → sidebar.favorites', () => {
    state.viewMode = 'favorites';
    const r = render(<ScopeTitle />);
    expect(r.container.textContent).toContain('sidebar.favorites');
  });

  it('viewMode=trash → sidebar.trash', () => {
    state.viewMode = 'trash';
    const r = render(<ScopeTitle />);
    expect(r.container.textContent).toContain('sidebar.trash');
  });

  it('选中 folder → 显示文件夹名', () => {
    state.viewMode = 'all';
    state.selectedFolderId = 'f-1';
    state.folders = [{ id: 'f-1', name: '工作' }];
    const r = render(<ScopeTitle />);
    expect(r.container.textContent).toContain('工作');
  });
});
