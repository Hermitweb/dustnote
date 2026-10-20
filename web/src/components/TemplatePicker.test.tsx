/**
 * TemplatePicker 测试
 *
 * 覆盖：
 * - 渲染预设 + 自定义区块
 * - 联机模式展示自定义分组，离线模式隐藏
 * - 自定义列表为空时显示 empty 文案
 * - 点击预设触发 createNoteFromTemplate 并 onClose
 * - UNFILED_ID 透传 null 给 store
 * - 自定义模板的删除按钮触发 deleteTemplate
 * - 删除 confirm 取消则不调用
 * - createNoteFromTemplate 失败显示 error 文本
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '../test/render';
import { UNFILED_ID } from '../lib/store-types';
import type { Template } from '@dustnote/shared';

const mockCreateNoteFromTemplate = vi.fn();
const mockDeleteTemplate = vi.fn();
let mockTemplates: Template[] = [];
let mockSelectedFolderId: string | null = null;
let mockMode: 'standalone' | 'online' = 'standalone';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => (opts ? `${k}:${JSON.stringify(opts)}` : k),
    i18n: { language: 'zh-CN' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('../lib/store', () => ({
  useStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        templates: mockTemplates,
        createNoteFromTemplate: mockCreateNoteFromTemplate,
        deleteTemplate: mockDeleteTemplate,
        selectedFolderId: mockSelectedFolderId,
        mode: mockMode,
      }),
    {
      getState: () => ({
        templates: mockTemplates,
        createNoteFromTemplate: mockCreateNoteFromTemplate,
        deleteTemplate: mockDeleteTemplate,
        selectedFolderId: mockSelectedFolderId,
        mode: mockMode,
      }),
    }
  ),
}));

import { TemplatePicker } from './TemplatePicker';

const makeTemplate = (overrides: Partial<Template> = {}): Template => ({
  id: 'tpl-1',
  userId: null,
  name: '空白笔记',
  description: '空白',
  category: 'blank',
  icon: '📄',
  isPreset: true,
  sortOrder: 0,
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
  content: '',
  ...overrides,
});

describe('TemplatePicker', () => {
  beforeEach(() => {
    mockTemplates = [
      makeTemplate({ id: 'preset-1', name: '空白', isPreset: true }),
      makeTemplate({ id: 'preset-2', name: '日记', isPreset: true }),
      makeTemplate({ id: 'custom-1', name: '我的模板', isPreset: false, userId: 'u-1' }),
    ];
    mockSelectedFolderId = null;
    mockMode = 'standalone';
    mockCreateNoteFromTemplate.mockResolvedValue(undefined);
    mockDeleteTemplate.mockResolvedValue(undefined);
    window.confirm = vi.fn(() => true);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('渲染预设区块', () => {
    const { container } = render(<TemplatePicker onClose={() => undefined} />);
    expect(container.textContent).toContain('templates.title');
    expect(container.textContent).toContain('空白');
    expect(container.textContent).toContain('日记');
  });

  it('联机模式下展示自定义分组', () => {
    mockMode = 'online';
    const { container } = render(<TemplatePicker onClose={() => undefined} />);
    expect(container.textContent).toContain('templates.custom');
    expect(container.textContent).toContain('我的模板');
  });

  it('单机模式下不展示自定义分组', () => {
    mockMode = 'standalone';
    const { container } = render(<TemplatePicker onClose={() => undefined} />);
    expect(container.textContent).not.toContain('templates.custom');
  });

  it('联机模式 + 自定义列表为空 → empty 文案', () => {
    mockMode = 'online';
    mockTemplates = [makeTemplate({ id: 'preset-1', isPreset: true })];
    const { container } = render(<TemplatePicker onClose={() => undefined} />);
    expect(container.textContent).toContain('templates.custom_empty');
  });

  it('点击预设触发 createNoteFromTemplate + onClose', async () => {
    const onClose = vi.fn();
    mockTemplates = [makeTemplate({ id: 'p-1', name: 'P', isPreset: true })];
    const { container } = render(<TemplatePicker onClose={onClose} />);
    // 第一个 preset button
    const presetBtn = container.querySelector<HTMLButtonElement>(
      'button[class*="hover:border-accent"]'
    );
    fireEvent.click(presetBtn!);
    await waitFor(() => {
      expect(mockCreateNoteFromTemplate).toHaveBeenCalledWith('p-1', null);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('UNFILED_ID 透传 null（不会把虚拟 ID 传给 store）', async () => {
    const onClose = vi.fn();
    mockSelectedFolderId = UNFILED_ID;
    mockTemplates = [makeTemplate({ id: 'p-1', isPreset: true })];
    const { container } = render(<TemplatePicker onClose={onClose} />);
    const presetBtn = container.querySelector<HTMLButtonElement>(
      'button[class*="hover:border-accent"]'
    );
    fireEvent.click(presetBtn!);
    await waitFor(() => {
      expect(mockCreateNoteFromTemplate).toHaveBeenCalledWith('p-1', null);
    });
  });

  it('点击自定义模板的删除按钮触发 deleteTemplate', async () => {
    mockMode = 'online';
    mockTemplates = [
      makeTemplate({ id: 'preset-1', isPreset: true }),
      makeTemplate({ id: 'custom-1', name: '我的模板', isPreset: false, userId: 'u-1' }),
    ];
    const { container } = render(<TemplatePicker onClose={() => undefined} />);
    // 删除按钮（绝对定位 + hover:block 样式）
    const deleteBtn = container.querySelector<HTMLButtonElement>('button[title*="delete"]');
    expect(deleteBtn).not.toBeNull();
    fireEvent.click(deleteBtn!);
    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalled();
      expect(mockDeleteTemplate).toHaveBeenCalledWith('custom-1');
    });
  });

  it('删除 confirm 取消时不调 deleteTemplate', () => {
    window.confirm = vi.fn(() => false);
    mockMode = 'online';
    mockTemplates = [
      makeTemplate({ id: 'preset-1', isPreset: true }),
      makeTemplate({ id: 'custom-1', name: '我的', isPreset: false, userId: 'u-1' }),
    ];
    const { container } = render(<TemplatePicker onClose={() => undefined} />);
    const deleteBtn = container.querySelector<HTMLButtonElement>('button[title*="delete"]');
    fireEvent.click(deleteBtn!);
    expect(mockDeleteTemplate).not.toHaveBeenCalled();
  });

  it('createNoteFromTemplate 失败显示错误文本', async () => {
    mockCreateNoteFromTemplate.mockRejectedValue(new Error('boom'));
    mockTemplates = [makeTemplate({ id: 'p-1', isPreset: true })];
    const { container } = render(<TemplatePicker onClose={() => undefined} />);
    const presetBtn = container.querySelector<HTMLButtonElement>(
      'button[class*="hover:border-accent"]'
    );
    fireEvent.click(presetBtn!);
    await waitFor(() => {
      expect(container.textContent).toContain('templates.error');
    });
  });

  it('scrim 点击触发 onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<TemplatePicker onClose={onClose} />);
    // scrim 是最外层 div（fixed inset-0），点击它
    const scrim = container.querySelector<HTMLDivElement>('.fixed.inset-0');
    fireEvent.click(scrim!);
    expect(onClose).toHaveBeenCalled();
  });
});
