/**
 * 空状态四态（阶段 2.4 · 修 U-7「空状态与响应式脱节」）
 *
 * 改造前所有空态共用一句「还没有笔记」，四种完全不同的处境给同一个答案：
 *   first-use   第一次用 —— 要的是引导（新建 / 导入）
 *   no-results  搜了没有 —— 要的是下一步（换关键词 / 看看标签 / 清掉筛选）
 *   empty-scope 这个范围是空的 —— 要的是往这里放东西的动作
 *   plain       回收站 / 收藏为空 —— 只要说明，不该把动作按钮糊在脸上
 *
 * 文案还随断点变：窄屏没有"右上角 +"可指，硬写指错地方比不写更糟（U-7 的另一半）。
 * 这里用两条 CSS 可见性切换，而不是读窗口宽度 —— 断点因此与 Tailwind 同一套，不会漂。
 */
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from './Icon';

export type EmptyKind = 'first-use' | 'no-results' | 'empty-scope' | 'plain';

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

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="glass-2 flex h-12 w-12 items-center justify-center rounded-xl border border-surface-border bg-surface-card">
        <Icon name={iconName} size={20} className="text-text-tertiary" />
      </div>
      <p className="text-sm font-medium text-text-primary">{title}</p>

      {kind === 'first-use' && (
        <p className="max-w-md text-xs text-text-secondary">
          <Both
            wide={t('sidebar.empty_first_hint_wide')}
            narrow={t('sidebar.empty_first_hint_narrow')}
          />
        </p>
      )}
      {kind === 'no-results' && (
        <p className="max-w-md text-xs text-text-secondary">
          <Both
            wide={t('sidebar.empty_results_hint_wide')}
            narrow={t('sidebar.empty_results_hint_narrow')}
          />
        </p>
      )}
      {kind === 'empty-scope' && (
        <p className="max-w-md text-xs text-text-secondary">{t('sidebar.empty_scope_hint')}</p>
      )}

      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        {(kind === 'first-use' || kind === 'empty-scope') && onNew && (
          <button
            onClick={onNew}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-strong px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-strong-hover"
          >
            <Icon name="add" size={14} />
            {t('app_bar.new_note')}
          </button>
        )}
        {kind === 'first-use' && onImport && (
          <button
            onClick={onImport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-1.5 text-xs text-text-primary transition-colors hover:bg-surface-bg"
          >
            <Icon name="download" size={14} />
            {t('sidebar.empty_import')}
          </button>
        )}
        {kind === 'no-results' && onClearQuery && (
          <button
            onClick={onClearQuery}
            className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-1.5 text-xs text-text-primary transition-colors hover:bg-surface-bg"
          >
            <Icon name="close" size={14} />
            {t('sidebar.empty_clear_query')}
          </button>
        )}
        {kind === 'no-results' && onShowTags && (
          <button
            onClick={onShowTags}
            className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-1.5 text-xs text-text-primary transition-colors hover:bg-surface-bg"
          >
            <Icon name="tag" size={14} />
            {t('sidebar.empty_show_tags')}
          </button>
        )}
      </div>
    </div>
  );
}

export default EmptyState;
