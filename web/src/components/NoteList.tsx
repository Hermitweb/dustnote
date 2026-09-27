/**
 * 舞台的「列表 / 搜索」态（UI 阶段 2.8）
 *
 * 笔记原先只以文件夹树叶子的形式存在，收藏 / 回收站 / 搜索时才有一个平铺列表。
 * 两栏改造后树只放导航，笔记统一在这里出现 —— 舞台因此有了真正的 list 与 search 态。
 * 列表用满舞台宽度：标题 + 摘要一行 + 时间 + 标签，而不是只有一个截断的标题。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNoteScope } from '../lib/note-scope';
import { formatNoteStamp } from '@dustnote/shared';
import { useStore } from '../lib/store';
import { EmptyState } from './EmptyState';
import { highlightMatches } from '../lib/search';
import { Icon, IconText } from './Icon';
import { MenuItem } from './MenuItem';
import { ConfirmDialog } from './ConfirmDialog';
import { toast } from '../lib/toast';
import { errorText } from '../lib/error-text';
import type { NoteRow } from '../lib/store';

const PAGE = 50;

/*
 * 列表滚动位置的记忆（§2.1「合并的代价与对策」）。
 * 两栏之后列表与正文共用同一栏：切进正文再退回来若从头开始，等于把合并的代价转嫁给用户。
 * 放模块作用域而不是 ref/state —— NoteList 在详情态会卸载，组件内的东西活不下来；
 * 而它也不该进 store：这是视图记忆，不是偏好，不该触发任何订阅者重渲染。
 */
const listScroll = new Map<string, number>();

/** 搜索命中标题高亮（highlightMatches 已转义 HTML，只插入 <mark>） */
function HighlightedTitle({
  title,
  matchedTokens,
}: {
  title: string;
  matchedTokens: Set<string> | undefined;
}) {
  if (!matchedTokens || matchedTokens.size === 0) {
    return <span className="truncate">{title}</span>;
  }
  return (
    <span
      className="truncate"
      dangerouslySetInnerHTML={{ __html: highlightMatches(title, matchedTokens) }}
    />
  );
}

function BatchBtn({ k, onClick, variant }: { k: string; onClick: () => void; variant?: 'danger' }) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
        variant === 'danger'
          ? 'border-danger/30 text-danger hover:bg-danger-soft'
          : 'border-surface-border text-surface-fg hover:bg-surface-bg'
      }`}
    >
      <IconText k={k} label={t(k)} />
    </button>
  );
}

export function NoteList() {
  const {
    t,
    notesPlain,
    folders,
    selectedFolderId,
    selectedNoteId,
    viewMode,
    sortKey,
    setSortKey,
    visibleNotes,
    visibleCount,
    loadMoreRef,
    searchHits,
    normalizedQuery,
    isTrash,
    isUnfiledScope,
    selecting,
    setSelecting,
    selectedIds,
    setSelectedIds,
    toggleSelect,
    selectAll,
    exitSelect,
    batchAction,
    doBatchAction,
    pendingBatchAction,
    setPendingBatchAction,
    batchConfirmMsg,
    showMoveDialog,
    setShowMoveDialog,
    permDeleteNoteId,
    setPermDeleteNoteId,
    selectNote,
    updateNote,
    permanentDeleteNote,
    restoreNote,
  } = useNoteScope();

  // 空状态要区分「第一次用」与「这个范围是空的」，所以还得知道库里到底有没有笔记
  const notesMap = useStore((st) => st.notes);
  const setDragNoteId = useStore((st) => st.setDragNoteId);
  const selectedTag = useStore((st) => st.selectedTag);
  const setSearchQ = useStore((st) => st.setSearchQuery);
  const aliveCount = useMemo(
    () => Array.from(notesMap.values()).filter((n) => !n.deletedAt).length,
    [notesMap]
  );
  const scopeKey = [viewMode, selectedFolderId, selectedTag, normalizedQuery].join('|');
  const listRef = useRef<HTMLUListElement | null>(null);
  /* 换范围 = 换一个记忆槽；同一范围回到原位 */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = listScroll.get(scopeKey) ?? 0;
  }, [scopeKey]);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; note: NoteRow } | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  /* 时间戳三端同一份实现（shared/time-format）：以前各端各写一套，
     同一篇笔记在 web / 小程序 / 移动端显示成三个样子 */
  const fmtTime = formatNoteStamp;

  const scopeLabel = normalizedQuery
    ? t('sidebar.matched', { count: visibleNotes.length })
    : isTrash
      ? `${t('sidebar.trash')} (${visibleNotes.length})`
      : viewMode === 'favorites'
        ? `${t('sidebar.favorites')} (${visibleNotes.length})`
        : isUnfiledScope
          ? `${t('editor.unfiled')} (${visibleNotes.length})`
          : `${folders.find((x) => x.id === selectedFolderId)?.name ?? t('sidebar.notes')} (${visibleNotes.length})`;

  const hasAll = visibleNotes.length > 0 && selectedIds.size === visibleNotes.length;

  /** 右键菜单的单条操作复用批量通道，避免两套删除逻辑分叉 */
  const onlyThis = (id: string) => {
    setSelecting(true);
    setSelectedIds(new Set([id]));
  };

  const confirmRename = async () => {
    if (!renameId) return;
    const name = renameValue.trim();
    if (name) {
      const plain = notesPlain.get(renameId);
      try {
        await updateNote(renameId, { title: name, content: plain?.content ?? '' });
        toast.success(t('sidebar.renamed'));
      } catch (err) {
        toast.error(errorText(err));
      }
    }
    setRenameId(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-3 border-b border-surface-border px-5 py-3">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{scopeLabel}</span>
        {!isTrash && visibleNotes.length > 0 && (
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
            className="rounded border border-surface-border bg-surface-bg px-1.5 py-1 text-xs focus:outline-none"
            title={t('sidebar.sort_label')}
            aria-label={t('sidebar.sort_label')}
          >
            <option value="updated">{t('sidebar.sort_updated')}</option>
            <option value="title">{t('sidebar.sort_title')}</option>
            <option value="words">{t('sidebar.sort_words')}</option>
          </select>
        )}
        {visibleNotes.length > 0 && (
          <button
            onClick={selectAll}
            className="rounded px-2 py-1 text-xs font-medium text-accent-text hover:bg-surface-bg"
          >
            {selecting
              ? hasAll
                ? t('sidebar.deselect_all')
                : t('sidebar.select_all')
              : t('sidebar.select')}
          </button>
        )}
      </div>

      {visibleNotes.length === 0 ? (
        <EmptyState
          kind={
            normalizedQuery
              ? 'no-results'
              : isTrash || viewMode === 'favorites' || selectedTag
                ? 'plain'
                : aliveCount === 0
                  ? 'first-use'
                  : 'empty-scope'
          }
          plainTitle={
            isTrash
              ? t('sidebar.trash_empty')
              : viewMode === 'favorites'
                ? t('sidebar.favorites_empty')
                : selectedTag
                  ? t('sidebar.empty_scope_title')
                  : t('sidebar.notes_empty')
          }
          icon={isTrash ? 'trash' : selectedTag ? 'tag' : undefined}
          query={normalizedQuery}
          onNew={() => window.dispatchEvent(new Event('app:new-note'))}
          onImport={() => window.dispatchEvent(new Event('app:import-export'))}
          onClearQuery={normalizedQuery ? () => setSearchQ('') : undefined}
        />
      ) : (
        <ul
          ref={listRef}
          onScroll={(e) => listScroll.set(scopeKey, (e.target as HTMLUListElement).scrollTop)}
          className="min-h-0 flex-1 divide-y divide-surface-border overflow-y-auto"
        >
          {visibleNotes.slice(0, visibleCount).map((n) => {
            const plain = notesPlain.get(n.id);
            const checked = selectedIds.has(n.id);
            const active = !selecting && selectedNoteId === n.id;
            return (
              <li key={n.id}>
                <div
                  /* 拖到导航轨的文件夹行即可移动（§2.1）：两栏之后没有第三列可拖了 */
                  draggable={!selecting}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/dustnote-note', n.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDragNoteId(n.id);
                  }}
                  onDragEnd={() => setDragNoteId(null)}
                  className={`group flex items-start gap-3 px-5 py-3 transition-colors ${
                    active
                      ? 'bg-accent-soft/40 dark:bg-accent/20'
                      : checked
                        ? 'bg-accent-soft/25 dark:bg-accent/10'
                        : 'hover:bg-surface-bg'
                  }`}
                  onContextMenu={(e) => {
                    if (selecting) return;
                    e.preventDefault();
                    setCtxMenu({ x: e.clientX, y: e.clientY, note: n });
                  }}
                >
                  {selecting && (
                    <button
                      onClick={() => toggleSelect(n.id)}
                      aria-pressed={checked}
                      className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded border text-[11px] font-bold transition-colors ${
                        checked
                          ? 'border-accent-strong bg-accent-strong text-white'
                          : 'border-surface-border text-transparent hover:border-accent'
                      }`}
                    >
                      ✓
                    </button>
                  )}
                  <button
                    onClick={() => (selecting ? toggleSelect(n.id) : selectNote(n.id))}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {n.isPinned && (
                        <Icon name="pin" size={14} className="flex-none text-warning" />
                      )}
                      {n.isFavorite && (
                        <Icon name="star" size={14} className="flex-none text-warning" />
                      )}
                      {plain ? (
                        <HighlightedTitle
                          title={plain.title}
                          matchedTokens={searchHits.get(n.id)}
                        />
                      ) : (
                        <span className="text-surface-muted">…</span>
                      )}
                    </span>
                    {plain?.content && (
                      <span className="mt-1 block truncate text-xs leading-relaxed text-surface-muted">
                        {plain.content.replace(/[#*>`\n-]/g, ' ').slice(0, 160)}
                      </span>
                    )}
                    <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-surface-muted">
                      <span className="tabular-nums">{fmtTime(n.serverUpdatedAt)}</span>
                      {plain?.tags?.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 rounded-full border border-surface-border px-1.5"
                        >
                          <Icon name="tag" size={14} />
                          {tag}
                        </span>
                      ))}
                    </span>
                  </button>
                  {isTrash && !selecting && (
                    <span className="flex flex-none gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        title={t('sidebar.restore')}
                        onClick={() => void restoreNote(n.id)}
                        className="rounded p-1 text-accent-text hover:bg-accent-soft/40"
                      >
                        <Icon name="refresh" size={14} />
                      </button>
                      <button
                        title={t('sidebar.perm_delete')}
                        onClick={() => setPermDeleteNoteId(n.id)}
                        className="rounded p-1 text-danger hover:bg-danger-soft"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
          {visibleCount < visibleNotes.length && (
            <li className="py-3 text-center text-xs text-surface-muted">
              <div ref={loadMoreRef}>
                {t('sidebar.load_more', {
                  count: Math.min(PAGE, visibleNotes.length - visibleCount),
                })}
              </div>
            </li>
          )}
        </ul>
      )}

      {selecting && selectedIds.size > 0 && (
        <div className="flex flex-none flex-wrap items-center gap-2 border-t border-surface-border bg-surface-card px-5 py-2.5">
          <span className="text-xs font-semibold text-accent-text">
            {t('sidebar.selected_count', { count: selectedIds.size })}
          </span>
          <span className="flex-1" />
          {!isTrash ? (
            <>
              <BatchBtn k="sidebar.batch.pin" onClick={() => void batchAction('pin')} />
              <BatchBtn k="sidebar.batch.unpin" onClick={() => void batchAction('unpin')} />
              <BatchBtn k="sidebar.batch.fav" onClick={() => void batchAction('fav')} />
              <BatchBtn k="sidebar.batch.unfav" onClick={() => void batchAction('unfav')} />
              <BatchBtn k="sidebar.batch.move" onClick={() => setShowMoveDialog(true)} />
              <BatchBtn
                k="sidebar.batch.delete"
                variant="danger"
                onClick={() => void batchAction('delete')}
              />
            </>
          ) : (
            <>
              <BatchBtn k="sidebar.batch.restore" onClick={() => void batchAction('restore')} />
              <BatchBtn
                k="sidebar.batch.perm_delete"
                variant="danger"
                onClick={() => void batchAction('permdelete')}
              />
            </>
          )}
          <button
            onClick={exitSelect}
            className="rounded p-1 text-surface-muted hover:bg-surface-bg"
            title={t('sidebar.exit_select')}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {ctxMenu && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setCtxMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setCtxMenu(null);
          }}
        >
          <div
            className="absolute min-w-44 rounded-xl border border-surface-border bg-surface-card py-1 shadow-2xl"
            style={{
              left: Math.min(ctxMenu.x, window.innerWidth - 200),
              top: Math.min(ctxMenu.y, window.innerHeight - 200),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <MenuItem
              k="sidebar.menu_rename"
              onClick={() => {
                setRenameId(ctxMenu.note.id);
                setRenameValue(notesPlain.get(ctxMenu.note.id)?.title ?? '');
                setCtxMenu(null);
              }}
            />
            <MenuItem
              k="sidebar.menu_move"
              onClick={() => {
                onlyThis(ctxMenu.note.id);
                setShowMoveDialog(true);
                setCtxMenu(null);
              }}
            />
            <MenuItem
              k="sidebar.menu_delete"
              danger
              onClick={() => {
                onlyThis(ctxMenu.note.id);
                void batchAction('delete');
                setCtxMenu(null);
              }}
            />
          </div>
        </div>
      )}

      {renameId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-xl bg-surface-card p-4 shadow-2xl">
            <label className="mb-2 block text-xs font-semibold text-surface-muted">
              {t('sidebar.menu_rename')}
            </label>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirmRename();
                if (e.key === 'Escape') setRenameId(null);
              }}
              className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setRenameId(null)}
                className="flex-1 rounded-lg border border-surface-border px-3 py-2 text-sm hover:bg-surface-bg"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => void confirmRename()}
                className="flex-1 rounded-lg bg-accent-strong px-3 py-2 text-sm font-semibold text-white hover:bg-accent-strong-hover"
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showMoveDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowMoveDialog(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-surface-card p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold">
              {t('sidebar.batch.move')} ({selectedIds.size})
            </h3>
            <div className="max-h-60 space-y-1 overflow-y-auto">
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    void doBatchAction('move', f.id);
                    setShowMoveDialog(false);
                  }}
                  className="block w-full truncate rounded px-3 py-2 text-left text-sm hover:bg-surface-bg"
                >
                  {f.name}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowMoveDialog(false)}
              className="mt-3 w-full rounded-lg border border-surface-border px-3 py-2 text-xs text-surface-muted hover:bg-surface-bg"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {pendingBatchAction && (
        <ConfirmDialog
          title={t('sidebar.batch.delete')}
          message={batchConfirmMsg}
          confirmLabel={t('common.delete')}
          variant="danger"
          onConfirm={() => {
            const a = pendingBatchAction;
            setPendingBatchAction(null);
            void doBatchAction(a);
          }}
          onCancel={() => setPendingBatchAction(null)}
        />
      )}

      {permDeleteNoteId && (
        <ConfirmDialog
          title={t('sidebar.perm_delete')}
          message={t('sidebar.confirm_permdelete', { count: 1 })}
          confirmLabel={t('common.delete')}
          variant="danger"
          onConfirm={() => {
            const id = permDeleteNoteId;
            setPermDeleteNoteId(null);
            void permanentDeleteNote(id).catch((err: unknown) => toast.error(errorText(err)));
          }}
          onCancel={() => setPermDeleteNoteId(null)}
        />
      )}
    </div>
  );
}

export default NoteList;
