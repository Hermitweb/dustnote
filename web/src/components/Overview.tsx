/**
 * 概览态（舞台三态之一，docs/ui-optimization.md §2.1）
 *
 * 替代原先"未选中笔记时整屏空白 + 一个小图标"的首屏：给出统计、最近编辑与常用入口，
 * 让第一次打开应用和只是回来看看的用户都有落点。
 *
 * 跨组件动作走 window 事件（`app:new-note` / `app:import-export`），
 * 与 App.tsx 已有的监听一致 —— 不为此把 App 的 state 往下钻。
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { formatNoteStamp } from '@dustnote/shared';
import { Icon, type IconName } from './Icon';

const fire = (name: string) => window.dispatchEvent(new Event(name));

/** 早中晚问候：按小时分三段，避免"凌晨还显示上午好" */
function greetingKey(hour: number): string {
  if (hour < 5) return 'overview.dawn';
  if (hour < 12) return 'overview.morning';
  if (hour < 18) return 'overview.afternoon';
  return 'overview.evening';
}

export function Overview() {
  const { t } = useTranslation();
  const notes = useStore((s) => s.notes);
  const notesPlain = useStore((s) => s.notesPlain);
  const selectNote = useStore((s) => s.selectNote);
  const setViewMode = useStore((s) => s.setViewMode);

  const { total, favorites, recent, tagCount } = useMemo(() => {
    const alive = [...notes.values()].filter((n) => !n.deletedAt);
    const fav = alive.filter((n) => n.isFavorite).length;
    const tags = new Set<string>();
    const list = alive
      .map((n) => ({ row: n, plain: notesPlain.get(n.id) }))
      .sort((a, b) => (b.row.clientUpdatedAt > a.row.clientUpdatedAt ? 1 : -1))
      .slice(0, 5);
    for (const p of notesPlain.values()) for (const tag of p.tags ?? []) tags.add(tag);
    return { total: alive.length, favorites: fav, recent: list, tagCount: tags.size };
  }, [notes, notesPlain]);

  // 与列表、小程序、移动端同一份时间格式（shared/time-format）
  const fmt = formatNoteStamp;

  const stats: { k: string; value: number; tone?: 'warning' }[] = [
    { k: 'overview.stat_notes', value: total },
    { k: 'overview.stat_favorites', value: favorites },
    { k: 'overview.stat_tags', value: tagCount },
  ];

  const actions: { k: string; icon: IconName; event: string; primary?: boolean }[] = [
    { k: 'overview.new_note', icon: 'add', event: 'app:new-note', primary: true },
    { k: 'overview.import', icon: 'download', event: 'app:import-export' },
    { k: 'overview.shares', icon: 'share', event: 'app:open-shares' },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-9">
      <h1 className="text-[1.875rem] font-bold tracking-tight">
        {t(greetingKey(new Date().getHours()))}
      </h1>
      <p className="mt-1 text-sm text-surface-muted">{t('overview.subtitle')}</p>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div
            key={s.k}
            className="glass-2 rounded-xl border border-surface-border bg-surface-card px-4 py-3 shadow-sm"
          >
            <div className="text-2xl font-bold tabular-nums">{s.value}</div>
            <div className="mt-0.5 text-xs text-surface-muted">{t(s.k)}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('overview.recent')}</h2>
        {/* 概览是首屏，就必须在这里给出去路：列表态由舞台的目的地决定（stage.ts） */}
        <button
          onClick={() => setViewMode('all')}
          className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline"
        >
          {t('overview.browse_all')}
          <Icon name="arrow-right" size={14} />
        </button>
      </div>
      {/* 窄屏没有 Ctrl N 可按：文案随断点换（§2.4） */}
      {recent.length === 0 ? (
        <p className="mt-2 text-sm text-text-secondary">
          <span className="hidden md:inline">{t('overview.no_recent')}</span>
          <span className="md:hidden">{t('overview.no_recent_narrow')}</span>
        </p>
      ) : (
        <ul className="glass-2 mt-2 divide-y divide-surface-border rounded-xl border border-surface-border bg-surface-card">
          {recent.map(({ row, plain }) => (
            <li key={row.id}>
              <button
                onClick={() => selectNote(row.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-bg"
              >
                <Icon
                  name={row.isPinned ? 'pin' : 'note'}
                  size={16}
                  className="shrink-0 text-surface-muted"
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {plain?.title || t('common.untitled')}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-surface-muted">
                  {fmt(row.clientUpdatedAt)}
                </span>
                <Icon name="arrow-right" size={14} className="shrink-0 text-surface-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 text-lg font-semibold">{t('overview.quick')}</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.k}
            onClick={() => fire(a.event)}
            className={
              a.primary
                ? 'inline-flex items-center gap-1.5 rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-strong-hover'
                : 'inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-bg'
            }
          >
            <Icon name={a.icon} size={14} />
            {t(a.k)}
          </button>
        ))}
      </div>

      <p className="mt-8 flex flex-wrap items-center gap-1.5 text-xs text-surface-muted">
        <kbd className="rounded border border-surface-border px-1.5 py-0.5 font-sans">Ctrl</kbd>
        <kbd className="rounded border border-surface-border px-1.5 py-0.5 font-sans">N</kbd>
        {t('overview.hint_new')}
        <span className="mx-1" />
        <kbd className="rounded border border-surface-border px-1.5 py-0.5 font-sans">Ctrl</kbd>
        <kbd className="rounded border border-surface-border px-1.5 py-0.5 font-sans">K</kbd>
        {t('overview.hint_search')}
        <span className="mx-1" />
        <kbd className="rounded border border-surface-border px-1.5 py-0.5 font-sans">?</kbd>
        {t('overview.hint_keys')}
      </p>
    </div>
  );
}

export default Overview;
