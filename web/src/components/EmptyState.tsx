/**
 * 空状态四态（阶段 2.4 · 修 U-7「空状态与响应式脱节」）
 *
 * 改造前所有空态共用一句「还没有笔记」，四种完全不同的处境给同一个答案：
 * first-use 第一次用 —— 要的是引导（新建 / 导入）
 * no-results 搜了没有 —— 要的是下一步（换关键词 / 看看标签 / 清掉筛选）
 * empty-scope 这个范围是空的 —— 要的是往这里放东西的动作
 * plain 回收站 / 收藏为空 —— 只要说明，不该把动作按钮糊在脸上
 *
 * 文案还随断点变：窄屏没有"右上角 +"可指，硬写指错地方比不写更糟（U-7 的另一半）。
 * 这里用两条 CSS 可见性切换，而不是读窗口宽度 —— 断点因此与 Tailwind 同一套，不会漂。
 *
 * 版面本身（图版块 / 节奏 / 字号）不在这里定：交给 StatePlate，
 * 与错误屏、加载屏共用同一起版，切状态时不会看见三种长相。
 */
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { StatePlate, type StateTone } from './StatePlate';

export type EmptyKind = 'first-use' | 'no-results' | 'empty-scope' | 'plain';

/** 按钮只有两档：主、次。此前四份近似的类名各写一遍，改一处忘三处 */
const BTN_PRIMARY =
  'inline-flex items-center gap-1.5 rounded-lg bg-accent-strong px-3 py-1.5 text-xs font-medium text-accent-on transition-colors hover:bg-accent-strong-hover';
const BTN_SECONDARY =
  'inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-1.5 text-xs text-text-primary transition-colors hover:bg-surface-bg';

/**
 * 可选属性一律写成「T | undefined」：仓库开了 exactOptionalPropertyTypes，
 * 而调用方很自然地会传 icon={cond ? 一个值 : undefined} —— 光靠 ? 是过不了类型的。
 */
export interface EmptyStateProps {
  kind: EmptyKind;
  /** kind='plain' 时的文案（回收站 / 收藏各自的说法） */
  plainTitle?: string | undefined;
  /** 搜索词，用于 no-results 的复述 */
  query?: string | undefined;
  icon?: IconName | undefined;
  onNew?: (() => void) | undefined;
  onImport?: (() => void) | undefined;
  onClearQuery?: (() => void) | undefined;
  onShowTags?: (() => void) | undefined;
}

/** 宽窄两版文案：窄屏不提快捷键与"右上角" */
function Both({ wide, narrow }: { wide: string; narrow: string }) {
  return (
    <>
      <span className="hidden md:inline">{wide}</span>
      <span className="md:hidden">{narrow}</span>
    </>
  );
}

/** 主/次按钮：动作数量与顺序在这里定，调用点只给行为 */
function Act({
  onClick,
  icon,
  label,
  primary = false,
}: {
  onClick: () => void;
  icon: IconName;
  label: ReactNode;
  primary?: boolean;
}) {
  return (
    <button onClick={onClick} className={primary ? BTN_PRIMARY : BTN_SECONDARY}>
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}

const TONE: Record<EmptyKind, StateTone> = {
  'first-use': 'guide',
  'no-results': 'info',
  'empty-scope': 'guide',
  plain: 'info',
};

export function EmptyState({
  kind,
  plainTitle,
  query,
  icon,
  onNew,
  onImport,
  onClearQuery,
  onShowTags,
}: EmptyStateProps) {
  const { t } = useTranslation();

  const title =
    kind === 'first-use'
      ? t('sidebar.empty_first_title')
      : kind === 'no-results'
        ? t('sidebar.empty_results_title', { query: query ?? '' })
        : kind === 'empty-scope'
          ? t('sidebar.empty_scope_title')
          : (plainTitle ?? t('sidebar.notes_empty'));

  const iconName: IconName =
    icon ?? (kind === 'no-results' ? 'search' : kind === 'first-use' ? 'notebook' : 'note');

  const hint =
    kind === 'first-use' ? (
      <Both
        wide={t('sidebar.empty_first_hint_wide')}
        narrow={t('sidebar.empty_first_hint_narrow')}
      />
    ) : kind === 'no-results' ? (
      <Both
        wide={t('sidebar.empty_results_hint_wide')}
        narrow={t('sidebar.empty_results_hint_narrow')}
      />
    ) : kind === 'empty-scope' ? (
      t('sidebar.empty_scope_hint')
    ) : null;

  const actions: ReactNode[] = [];
  if ((kind === 'first-use' || kind === 'empty-scope') && onNew) {
    actions.push(
      <Act key="new" onClick={onNew} icon="add" label={t('app_bar.new_note')} primary />
    );
  }
  if (kind === 'first-use' && onImport) {
    actions.push(
      <Act key="import" onClick={onImport} icon="download" label={t('sidebar.empty_import')} />
    );
  }
  if (kind === 'no-results' && onClearQuery) {
    actions.push(
      <Act key="clear" onClick={onClearQuery} icon="close" label={t('sidebar.empty_clear_query')} />
    );
  }
  if (kind === 'no-results' && onShowTags) {
    actions.push(
      <Act key="tags" onClick={onShowTags} icon="tag" label={t('sidebar.empty_show_tags')} />
    );
  }

  return (
    <StatePlate
      icon={iconName}
      tone={TONE[kind]}
      title={title}
      hint={hint}
      actions={actions.length ? actions : undefined}
    />
  );
}

export default EmptyState;
