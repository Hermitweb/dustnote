/**
 * CommandPalette 测试
 *
 * 覆盖：
 * - 默认不渲染
 * - 'app:toggle-command-palette' 事件触发开/关
 * - 外部传入 commands 时优先使用
 * - 模糊搜索 + 评分排序 + title 高亮
 * - 键盘导航：↑/↓/Enter/Esc
 * - 点击 scrim 关闭
 * - 无结果时显示 empty 文案
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '../test/render';
import type { Command } from './CommandPalette';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { CommandPalette } from './CommandPalette';

const sampleCommands: Command[] = [
  { id: 'a', title: 'New Note', category: 'navigation', icon: 'note', action: vi.fn() },
  { id: 'b', title: 'Lock', category: 'navigation', icon: 'lock', action: vi.fn() },
  {
    id: 'c',
    title: 'Settings',
    category: 'operations',
    icon: 'settings',
    keywords: 'prefs config',
    action: vi.fn(),
  },
  { id: 'd', title: 'About', category: 'about', icon: 'info', action: vi.fn() },
];

describe('CommandPalette', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('默认不渲染', () => {
    const { container } = render(<CommandPalette />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("'app:toggle-command-palette' 事件切换开/关", () => {
    const { container } = render(<CommandPalette commands={sampleCommands} />);
    act(() => {
      window.dispatchEvent(new Event('app:toggle-command-palette'));
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event('app:toggle-command-palette'));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('打开时显示所有分类与命令标题', () => {
    const { container } = render(<CommandPalette commands={sampleCommands} />);
    act(() => {
      window.dispatchEvent(new Event('app:toggle-command-palette'));
    });
    expect(container.textContent).toContain('New Note');
    expect(container.textContent).toContain('Lock');
    expect(container.textContent).toContain('Settings');
    expect(container.textContent).toContain('About');
    expect(container.textContent).toContain('command_palette.category_navigation');
    expect(container.textContent).toContain('command_palette.category_operations');
    expect(container.textContent).toContain('command_palette.category_about');
  });

  it('搜索过滤：仅显示匹配的命令并按分数排序', () => {
    const { container } = render(<CommandPalette commands={sampleCommands} />);
    act(() => {
      window.dispatchEvent(new Event('app:toggle-command-palette'));
    });
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(input, 'lck');
    // 'Lock' 模糊匹配
    expect(container.textContent).toContain('Lock');
    expect(container.textContent).not.toContain('New Note');
    expect(container.textContent).not.toContain('Settings');
  });

  it('搜索通过 keywords 命中', () => {
    const { container } = render(<CommandPalette commands={sampleCommands} />);
    act(() => {
      window.dispatchEvent(new Event('app:toggle-command-palette'));
    });
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(input, 'config');
    // Settings 通过 keywords 'prefs config' 命中
    expect(container.textContent).toContain('Settings');
  });

  it('搜索高亮命中字符', () => {
    const { container } = render(<CommandPalette commands={sampleCommands} />);
    act(() => {
      window.dispatchEvent(new Event('app:toggle-command-palette'));
    });
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(input, 'nw');
    // 'New Note' 中 N/w 命中 → <mark> 标签
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBeGreaterThan(0);
  });

  it('无结果时显示 empty 文案', () => {
    const { container } = render(<CommandPalette commands={sampleCommands} />);
    act(() => {
      window.dispatchEvent(new Event('app:toggle-command-palette'));
    });
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(input, 'xyzqwertynothing');
    expect(container.textContent).toContain('command_palette.no_results');
  });

  it('键盘 ArrowDown / ArrowUp 改变 selectedIdx', () => {
    const { container } = render(<CommandPalette commands={sampleCommands} />);
    act(() => {
      window.dispatchEvent(new Event('app:toggle-command-palette'));
    });
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    // 默认 selectedIdx=0
    let selected = container.querySelector('[aria-selected="true"]');
    expect(selected?.textContent).toContain('New Note');
    fireEvent.keyDown(input, 'ArrowDown');
    selected = container.querySelector('[aria-selected="true"]');
    expect(selected?.textContent).toContain('Lock');
    fireEvent.keyDown(input, 'ArrowUp');
    fireEvent.keyDown(input, 'ArrowUp');
    selected = container.querySelector('[aria-selected="true"]');
    expect(selected?.textContent).toContain('New Note');
  });

  it('键盘 ArrowUp 不越过 0；ArrowDown 不越过末位', () => {
    const { container } = render(<CommandPalette commands={sampleCommands} />);
    act(() => {
      window.dispatchEvent(new Event('app:toggle-command-palette'));
    });
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.keyDown(input, 'ArrowUp');
    let selected = container.querySelector('[aria-selected="true"]');
    expect(selected?.textContent).toContain('New Note');
    // 多次 ArrowDown 到末尾
    for (let i = 0; i < 10; i++) fireEvent.keyDown(input, 'ArrowDown');
    selected = container.querySelector('[aria-selected="true"]');
    expect(selected?.textContent).toContain('About');
  });

  it('键盘 Enter 触发选中命令的 action 并关闭面板', () => {
    const { container } = render(<CommandPalette commands={sampleCommands} />);
    act(() => {
      window.dispatchEvent(new Event('app:toggle-command-palette'));
    });
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(input, 'Settings');
    fireEvent.keyDown(input, 'Enter');
    expect(sampleCommands[2]!.action).toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('键盘 Esc 关闭面板', () => {
    const { container } = render(<CommandPalette commands={sampleCommands} />);
    act(() => {
      window.dispatchEvent(new Event('app:toggle-command-palette'));
    });
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.keyDown(input, 'Escape');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('点击 scrim 关闭面板', () => {
    const { container } = render(<CommandPalette commands={sampleCommands} />);
    act(() => {
      window.dispatchEvent(new Event('app:toggle-command-palette'));
    });
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.click(dialog);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('点击命令按钮触发 action 并关闭', () => {
    const { container } = render(<CommandPalette commands={sampleCommands} />);
    act(() => {
      window.dispatchEvent(new Event('app:toggle-command-palette'));
    });
    const buttons = container.querySelectorAll<HTMLButtonElement>('button[data-idx]');
    fireEvent.click(buttons[0]!);
    expect(sampleCommands[0]!.action).toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('打开时重置 selectedIdx（多次开关）', () => {
    const { container } = render(<CommandPalette commands={sampleCommands} />);
    act(() => {
      window.dispatchEvent(new Event('app:toggle-command-palette'));
    });
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.keyDown(input, 'ArrowDown'); // selectedIdx=1
    fireEvent.keyDown(input, 'ArrowDown'); // selectedIdx=2
    act(() => {
      window.dispatchEvent(new Event('app:toggle-command-palette')); // 关闭
    });
    act(() => {
      window.dispatchEvent(new Event('app:toggle-command-palette')); // 重开 → selectedIdx=0
    });
    const input2 = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.keyDown(input2, 'Enter');
    expect(sampleCommands[0]!.action).toHaveBeenCalled();
  });
});
