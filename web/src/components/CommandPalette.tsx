/**
 * 命令面板（Command Palette）
 *
 * 类似 VS Code 的 Ctrl+K / Cmd+K，提供快速命令访问。
 * - 全局快捷键 Ctrl+K（在 use-keyboard-shortcuts.ts 中注册）派发
 *   'app:toggle-command-palette' 事件切换开/关
 * - 模糊搜索命令列表（子序列匹配 + 评分排序）
 * - 键盘导航：↑↓ 选择，Enter 执行，Esc 关闭
 * - 命令通过 window 自定义事件触发执行（如 'app:new-note' / 'app:lock' /
 *   'app:open-settings'），由 App.tsx 监听并执行实际逻辑
 * - 纯 React + Tailwind 实现，无外部依赖
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** 命令分类 */
export type CommandCategory = 'navigation' | 'operations' | 'about';

/** 命令定义 */
export interface Command {
  /** 唯一 ID */
  id: string;
  /** i18n 标题键（优先于 title） */
  titleKey?: string;
  /** 标题（titleKey 不可用时使用） */
  title?: string;
  /** 副标题/快捷键提示（展示在右侧） */
  hint?: string;
  /** 分类 */
  category: CommandCategory;
  /** 图标 emoji */
  icon: string;
  /** 额外匹配关键词（用于模糊搜索，不展示） */
  keywords?: string;
  /** 执行命令 */
  action: () => void;
}

/** 分类展示顺序 */
const CATEGORY_ORDER: readonly CommandCategory[] = [
  'navigation',
  'operations',
  'about',
] as const;

/** 分类标签 i18n key */
const CATEGORY_LABEL_KEY: Record<CommandCategory, string> = {
  navigation: 'command_palette.category_navigation',
  operations: 'command_palette.category_operations',
  about: 'command_palette.category_about',
};

/** 模糊匹配结果 */
interface FuzzyResult {
  matched: boolean;
  score: number;
  /** 命中字符在 target 中的索引 */
  indices: number[];
}

/**
 * 简单的子序列模糊匹配 + 评分。
 * - 连续命中加分（鼓励紧凑匹配）
 * - 首字命中加分（鼓励前缀匹配）
 * - 词首命中加分（鼓励整词匹配）
 */
function fuzzyMatch(query: string, target: string): FuzzyResult {
  if (!query) return { matched: true, score: 1, indices: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const indices: number[] = [];
  let qi = 0;
  let score = 0;
  let prevIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t.charAt(ti) === q.charAt(qi)) {
      indices.push(ti);
      // 连续命中加分
      if (prevIdx === ti - 1) score += 5;
      // 首字命中加分（越靠前分越高）
      if (indices.length === 1) score += Math.max(0, 10 - ti);
      // 词首命中加分（前一个字符是空白或位于串首）
      if (ti === 0 || /\s/.test(t.charAt(ti - 1))) score += 3;
      score += 1;
      prevIdx = ti;
      qi++;
    }
  }
  if (qi !== q.length) return { matched: false, score: 0, indices: [] };
  return { matched: true, score, indices };
}

/** 把一段文本渲染为节点，命中部分用 <mark> 包裹 */
function flushBuffer(text: string, isMatch: boolean, key: number): ReactNode {
  if (isMatch) return <mark key={key}>{text}</mark>;
  return <span key={key}>{text}</span>;
}

/** 高亮渲染：把 indices 对应的字符包进 <mark> */
function renderHighlighted(text: string, indices: number[]): ReactNode {
  if (indices.length === 0) return text;
  const set = new Set(indices);
  const nodes: ReactNode[] = [];
  let buffer = '';
  let bufferIsMatch = false;
  for (let i = 0; i < text.length; i++) {
    const isMatch = set.has(i);
    if (i === 0) {
      buffer = text.charAt(i);
      bufferIsMatch = isMatch;
      continue;
    }
    if (isMatch === bufferIsMatch) {
      buffer += text.charAt(i);
    } else {
      nodes.push(flushBuffer(buffer, bufferIsMatch, nodes.length));
      buffer = text.charAt(i);
      bufferIsMatch = isMatch;
    }
  }
  if (buffer) {
    nodes.push(flushBuffer(buffer, bufferIsMatch, nodes.length));
  }
  return <>{nodes}</>;
}

/** 带评分的命令条目（用于过滤后的列表） */
interface ScoredEntry {
  cmd: Command;
  score: number;
  /** title 中命中的字符索引（用于高亮） */
  indices: number[];
}

/** 分类分组条目（保留扁平索引用于键盘导航） */
interface GroupedEntry {
  entry: ScoredEntry;
  flatIdx: number;
}

export function CommandPalette({ commands }: { commands?: Command[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /** 内置命令列表（通过 window 自定义事件触发，由 App.tsx 监听执行） */
  const builtinCommands = useMemo<Command[]>(
    () => [
      {
        id: 'new-note',
        titleKey: 'command_palette.new_note',
        category: 'navigation',
        icon: '📝',
        hint: 'Ctrl+N',
        keywords: 'new note create add',
        action: () => window.dispatchEvent(new CustomEvent('app:new-note')),
      },
      {
        id: 'lock',
        titleKey: 'command_palette.lock',
        category: 'navigation',
        icon: '🔒',
        hint: 'Ctrl+L',
        keywords: 'lock logout sign out',
        action: () => window.dispatchEvent(new CustomEvent('app:lock')),
      },
      {
        id: 'settings',
        titleKey: 'command_palette.settings',
        category: 'navigation',
        icon: '⚙️',
        hint: 'Ctrl+,',
        keywords: 'settings preferences config',
        action: () => window.dispatchEvent(new CustomEvent('app:open-settings')),
      },
      {
        id: 'shares',
        titleKey: 'command_palette.shares',
        category: 'navigation',
        icon: '🔗',
        keywords: 'share link shares',
        action: () => window.dispatchEvent(new CustomEvent('app:open-shares')),
      },
      {
        id: 'toggle-theme',
        titleKey: 'command_palette.toggle_theme',
        category: 'operations',
        icon: '🎨',
        keywords: 'theme color skin switch',
        action: () => window.dispatchEvent(new CustomEvent('app:toggle-theme')),
      },
      {
        id: 'toggle-mode',
        titleKey: 'command_palette.toggle_mode',
        category: 'operations',
        icon: '🌓',
        keywords: 'mode light dark appearance',
        action: () => window.dispatchEvent(new CustomEvent('app:toggle-mode')),
      },
      {
        id: 'import-export',
        titleKey: 'command_palette.import_export',
        category: 'operations',
        icon: '📦',
        keywords: 'import export backup',
        action: () => window.dispatchEvent(new CustomEvent('app:import-export')),
      },
      {
        id: 'about',
        titleKey: 'command_palette.about',
        category: 'about',
        icon: 'ℹ️',
        keywords: 'about version help info',
        action: () => window.dispatchEvent(new CustomEvent('app:about')),
      },
    ],
    [],
  );

  const allCommands = commands ?? builtinCommands;

  /** 获取命令的显示标题（优先 i18n） */
  const getTitle = useCallback(
    (cmd: Command): string => {
      if (cmd.titleKey) return t(cmd.titleKey);
      return cmd.title ?? cmd.id;
    },
    [t],
  );

  /** 过滤 + 评分 + 排序 */
  const filtered = useMemo<ScoredEntry[]>(() => {
    const q = query.trim();
    const results: ScoredEntry[] = [];
    for (const cmd of allCommands) {
      const title = getTitle(cmd);
      const titleResult = fuzzyMatch(q, title);
      const kw = cmd.keywords ?? '';
      const kwResult = kw ? fuzzyMatch(q, kw) : { matched: false, score: 0, indices: [] };
      if (titleResult.matched || kwResult.matched) {
        results.push({
          cmd,
          score: Math.max(titleResult.score, kwResult.score),
          // 仅对 title 部分高亮
          indices: titleResult.matched ? titleResult.indices : [],
        });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  }, [allCommands, query, getTitle]);

  /** 按分类分组（保留扁平索引用于键盘导航） */
  const grouped = useMemo(() => {
    const map = new Map<CommandCategory, GroupedEntry[]>();
    filtered.forEach((entry, flatIdx) => {
      const arr = map.get(entry.cmd.category) ?? [];
      arr.push({ entry, flatIdx });
      map.set(entry.cmd.category, arr);
    });
    return map;
  }, [filtered]);

  // 监听 Ctrl+K 切换事件（由 use-keyboard-shortcuts.ts 派发）
  useEffect(() => {
    const toggle = () => setOpen((v) => !v);
    window.addEventListener('app:toggle-command-palette', toggle);
    return () => window.removeEventListener('app:toggle-command-palette', toggle);
  }, []);

  // 打开时重置状态 + 聚焦输入框
  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setSelectedIdx(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // 选中项滚动到可见区域
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, open]);

  // selectedIdx 越界保护（过滤后列表变短时回退）
  useEffect(() => {
    if (selectedIdx > 0 && selectedIdx >= filtered.length) {
      setSelectedIdx(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIdx]);

  if (!open) return null;

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = filtered[selectedIdx];
      if (entry) {
        entry.cmd.action();
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 p-4 pt-[15vh]"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label={t('command_palette.title')}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-surface-border bg-surface-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* 搜索输入框 */}
        <div className="flex items-center gap-3 border-b border-surface-border px-4 py-3">
          <span className="text-surface-muted">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIdx(0);
            }}
            placeholder={t('command_palette.placeholder')}
            className="flex-1 bg-transparent text-sm text-surface-fg outline-none placeholder:text-surface-muted"
            autoComplete="off"
            spellCheck={false}
            aria-label={t('command_palette.placeholder')}
          />
          <kbd className="rounded bg-surface-bg px-2 py-0.5 font-mono text-xs text-surface-muted">
            Esc
          </kbd>
        </div>

        {/* 结果列表（最多显示约 8 项，超出可滚动） */}
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-surface-muted">
            {t('command_palette.no_results')}
          </div>
        ) : (
          <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
            {CATEGORY_ORDER.map((cat) => {
              const items = grouped.get(cat);
              if (!items || items.length === 0) return null;
              const labelKey = CATEGORY_LABEL_KEY[cat] ?? 'command_palette.title';
              return (
                <div key={cat} className="mb-2 last:mb-0">
                  <div className="px-2 py-1 text-xs font-semibold text-surface-muted">
                    {t(labelKey)}
                  </div>
                  {items.map(({ entry, flatIdx }) => {
                    const isSelected = flatIdx === selectedIdx;
                    const title = getTitle(entry.cmd);
                    return (
                      <button
                        key={entry.cmd.id}
                        type="button"
                        data-idx={flatIdx}
                        onMouseMove={() => {
                          setSelectedIdx((prev) => (prev === flatIdx ? prev : flatIdx));
                        }}
                        onClick={() => {
                          entry.cmd.action();
                          setOpen(false);
                        }}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                          isSelected
                            ? 'bg-mint-50 text-surface-fg'
                            : 'text-surface-fg hover:bg-surface-bg'
                        }`}
                        aria-selected={isSelected}
                      >
                        <span className="flex-shrink-0 text-base">{entry.cmd.icon}</span>
                        <span className="flex-1 truncate">
                          {renderHighlighted(title, entry.indices)}
                        </span>
                        {entry.cmd.hint && (
                          <kbd className="flex-shrink-0 rounded bg-surface-bg px-1.5 py-0.5 font-mono text-xs text-surface-muted">
                            {entry.cmd.hint}
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* 底部提示条 */}
        <div className="flex items-center gap-4 border-t border-surface-border px-4 py-2 text-xs text-surface-muted">
          <span>
            <kbd className="rounded bg-surface-bg px-1 py-0.5">↑</kbd>{' '}
            <kbd className="rounded bg-surface-bg px-1 py-0.5">↓</kbd>{' '}
            {t('command_palette.hint_navigate')}
          </span>
          <span>
            <kbd className="rounded bg-surface-bg px-1 py-0.5">↵</kbd>{' '}
            {t('command_palette.hint_execute')}
          </span>
          <span>
            <kbd className="rounded bg-surface-bg px-1 py-0.5">Esc</kbd>{' '}
            {t('command_palette.hint_esc_close')}
          </span>
        </div>
      </div>
    </div>
  );
}
