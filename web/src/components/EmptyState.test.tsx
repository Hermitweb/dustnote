/**
 * EmptyState 测试
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => (opts?.query ? `${k}:${opts.query}` : k),
    i18n: { language: 'zh-CN' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { EmptyState } from '../components/EmptyState';

describe('EmptyState', () => {
  afterEach(() => cleanup());

  it('first-use → 渲染 title + 新建按钮（onNew）', () => {
    const onNew = vi.fn();
    const r = render(<EmptyState kind="first-use" onNew={onNew} />);
    expect(r.container.textContent).toContain('sidebar.empty_first_title');
    const btns = Array.from(r.container.querySelectorAll('button'));
    expect(btns.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(btns[0] as HTMLElement);
    expect(onNew).toHaveBeenCalled();
  });

  it('no-results + query → 复述查询词', () => {
    const r = render(<EmptyState kind="no-results" query="密钥" />);
    expect(r.container.textContent).toContain('密钥');
  });

  it('empty-scope + onNew → 新建触发', () => {
    const onNew = vi.fn();
    const r = render(<EmptyState kind="empty-scope" onNew={onNew} />);
    const btn = r.container.querySelector('button') as HTMLElement;
    fireEvent.click(btn);
    expect(onNew).toHaveBeenCalled();
  });

  it('plain + plainTitle → 文案显示', () => {
    const r = render(<EmptyState kind="plain" plainTitle="回收站是空的" />);
    expect(r.container.textContent).toContain('回收站是空的');
  });

  it('无 actions 时不渲染 action 按钮', () => {
    const r = render(<EmptyState kind="plain" />);
    expect(r.container.querySelector('button')).toBeNull();
  });
});
