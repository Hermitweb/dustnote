import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { useState, useCallback } from 'react';

export function Sidebar() {
  const { t } = useTranslation();
  const folders = useStore((s) => s.folders);
  const tags = useStore((s) => s.tags);
  const notes = useStore((s) => s.notes);
  const notesPlain = useStore((s) => s.notesPlain);
  const selectedFolderId = useStore((s) => s.selectedFolderId);
  const selectedNoteId = useStore((s) => s.selectedNoteId);
  const viewMode = useStore((s) => s.viewMode);

  const selectFolder = useStore((s) => s.selectFolder);
  const createFolder = useStore((s) => s.createFolder);
  const createNote = useStore((s) => s.createNote);
  const selectNote = useStore((s) => s.selectNote);
  const setViewMode = useStore((s) => s.setViewMode);
  const permanentDeleteNote = useStore((s) => s.permanentDeleteNote);
  const emptyTrash = useStore((s) => s.emptyTrash);
  const restoreNote = useStore((s) => s.restoreNote);
  const deleteNote = useStore((s) => s.deleteNote);
  const updateNote = useStore((s) => s.updateNote);
  const moveNote = useStore((s) => s.moveNote);

  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);

  // ========== 多选 ==========
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const exitSelect = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (next.size === 0) setSelecting(false);
        return next;
      }
      next.add(id);
      return next;
    });
  }, []);

  const toggleAll = () => {
    if (selectedIds.size === visibleNotes.length) {
      setSelecting(false);
      setSelectedIds(new Set());
    } else setSelectedIds(new Set(visibleNotes.map((n) => n.id)));
  };

  // ========== 批量操作 ==========
  const batchAction = async (action: string) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (action === 'delete' || action === 'permdelete') {
      if (!confirm(`确定${action === 'permdelete' ? '永久' : ''}删除选中的 ${ids.length} 条笔记？`))
        return;
    }
    let ok = 0;
    for (const id of ids) {
      try {
        if (action === 'delete') {
          await deleteNote(id);
          ok++;
        } else if (action === 'permdelete') {
          await permanentDeleteNote(id);
          ok++;
        } else if (action === 'restore') {
          await restoreNote(id);
          ok++;
        } else if (action === 'pin') {
          await updateNote(id, { isPinned: true });
          ok++;
        } else if (action === 'unpin') {
          await updateNote(id, { isPinned: false });
          ok++;
        } else if (action === 'fav') {
          await updateNote(id, { isFavorite: true });
          ok++;
        } else if (action === 'unfav') {
          await updateNote(id, { isFavorite: false });
          ok++;
        } else if (action === 'move') {
          const fid = prompt('输入目标文件夹 ID（留空=未分类）：');
          await moveNote(id, fid || null);
          ok++;
        }
      } catch {
        /* skip */
      }
    }
    exitSelect();
    const labels: Record<string, string> = {
      delete: '删除',
      permdelete: '永久删除',
      restore: '恢复',
      pin: '置顶',
      unpin: '取消置顶',
      fav: '收藏',
      unfav: '取消收藏',
      move: '移动',
    };
    alert(`已完成：${labels[action]} ${ok} 条`);
  };

  // ========== 可见笔记 ==========
  const visibleNotes = Array.from(notes.values())
    .filter((n) => {
      if (viewMode === 'trash') return !!n.deletedAt;
      if (viewMode === 'favorites') return !n.deletedAt && n.isFavorite;
      return !n.deletedAt;
    })
    .filter((n) => (selectedFolderId ? n.folderId === selectedFolderId : true))
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return b.serverUpdatedAt.localeCompare(a.serverUpdatedAt);
    });

  const trashCount = Array.from(notes.values()).filter((n) => n.deletedAt).length;
  const isTrash = viewMode === 'trash';
  const selCount = selectedIds.size;
  const hasAll = visibleNotes.length > 0 && selectedIds.size === visibleNotes.length;

  return (
    <aside className="flex h-full w-72 flex-col border-r border-surface-border bg-surface-card">
      {/* 顶栏 */}
      <div className="border-b border-surface-border p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-mint-100 text-mint-600 dark:bg-mint-900/30">
            🌿
          </div>
          <h1 className="text-base font-bold text-surface-fg">{t('app.name')}</h1>
        </div>
        {!selecting && (
          <button
            onClick={() => {
              void createNote(selectedFolderId);
            }}
            className="w-full rounded-lg bg-mint-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-mint-700"
          >
            {t('app_bar.new_note')}
          </button>
        )}
        {selecting && (
          <button
            onClick={exitSelect}
            className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-surface-fg hover:bg-surface-sunken"
          >
            ✕ 退出选择模式
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <NavItem
          label={t('sidebar.all')}
          icon="📝"
          active={viewMode === 'all' && !selectedFolderId}
          onClick={() => setViewMode('all')}
        />
        <NavItem
          label={t('sidebar.favorites')}
          icon="⭐"
          active={viewMode === 'favorites'}
          onClick={() => setViewMode('favorites')}
        />
        <NavItem
          label={`${t('sidebar.trash')}${trashCount > 0 ? ` (${trashCount})` : ''}`}
          icon="🗑️"
          active={viewMode === 'trash'}
          onClick={() => setViewMode('trash')}
        />

        {isTrash && trashCount > 0 && (
          <div className="mt-1 flex gap-1 px-2">
            <button
              onClick={() => {
                if (confirm(`确定要清空回收站（${trashCount} 条笔记将被永久删除）吗？`))
                  void emptyTrash();
              }}
              className="flex-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
            >
              清空回收站
            </button>
          </div>
        )}

        {/* 文件夹 */}
        {viewMode !== 'trash' && (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between px-2 text-xs font-semibold text-surface-muted">
              {t('sidebar.folders')}
              <button
                onClick={() => setShowNewFolder(true)}
                className="text-mint-600 hover:text-mint-700"
              >
                {t('sidebar.add_folder')}
              </button>
            </div>
            {showNewFolder && (
              <div className="mb-2 flex gap-1 px-2">
                <input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  autoFocus
                  placeholder="文件夹名"
                  className="flex-1 rounded border border-surface-border bg-surface-bg px-2 py-1 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newFolderName) {
                      void createFolder(newFolderName);
                      setNewFolderName('');
                      setShowNewFolder(false);
                    }
                    if (e.key === 'Escape') {
                      setShowNewFolder(false);
                      setNewFolderName('');
                    }
                  }}
                />
              </div>
            )}
            {folders.length === 0 ? (
              <p className="px-2 text-xs text-surface-muted">{t('sidebar.empty_folders')}</p>
            ) : (
              folders.map((f) => (
                <NavItem
                  key={f.id}
                  label={f.name}
                  icon={f.icon ?? '📁'}
                  active={viewMode === 'all' && selectedFolderId === f.id}
                  onClick={() => selectFolder(f.id)}
                />
              ))
            )}
          </div>
        )}

        {/* 标签 */}
        {viewMode !== 'trash' && tags.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 px-2 text-xs font-semibold text-surface-muted">
              {t('sidebar.tags')}
            </div>
            {tags.slice(0, 8).map((tag) => (
              <div
                key={tag.id}
                className="flex items-center justify-between rounded px-2 py-1 text-sm text-surface-fg hover:bg-surface-bg"
              >
                <span># {tag.name}</span>
                <span className="text-xs text-surface-muted">{tag.count}</span>
              </div>
            ))}
          </div>
        )}

        {/* 笔记列表 */}
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="text-xs font-semibold text-surface-muted">
              {isTrash
                ? `${t('sidebar.trash')} (${visibleNotes.length})`
                : viewMode === 'favorites'
                  ? `${t('sidebar.favorites')} (${visibleNotes.length})`
                  : `${t('sidebar.all')} (${visibleNotes.length})`}
            </span>
            {visibleNotes.length > 0 && (
              <button
                onClick={() => {
                  if (selecting) exitSelect();
                  else setSelecting(true);
                  toggleAll();
                }}
                className="text-xs text-mint-600 hover:text-mint-700"
              >
                {selecting ? (hasAll ? '取消全选' : '全选') : '选择'}
              </button>
            )}
          </div>
          {visibleNotes.length === 0 ? (
            <p className="px-2 text-xs text-surface-muted">
              {isTrash ? '回收站为空' : viewMode === 'favorites' ? '还没有收藏' : '还没有笔记'}
            </p>
          ) : (
            visibleNotes.slice(0, 50).map((n) => {
              const plain = notesPlain.get(n.id);
              const checked = selectedIds.has(n.id);
              return (
                <div
                  key={n.id}
                  className={`group relative rounded ${checked ? 'bg-mint-100/80 dark:bg-mint-900/20' : ''}`}
                >
                  <div className="flex items-center">
                    {selecting && (
                      <button
                        onClick={() => toggleSelect(n.id)}
                        className={`ml-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors ${
                          checked
                            ? 'border-mint-600 bg-mint-600 text-white'
                            : 'border-surface-border hover:border-mint-400'
                        }`}
                      >
                        {checked && '✓'}
                      </button>
                    )}
                    <button
                      onClick={() => (selecting ? toggleSelect(n.id) : selectNote(n.id))}
                      className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm transition-colors ${
                        !selecting && selectedNoteId === n.id
                          ? 'bg-mint-50 dark:bg-mint-900/30'
                          : 'hover:bg-surface-bg'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {n.isPinned && <span className="text-xs">📌</span>}
                        {n.isFavorite && <span className="text-xs">⭐</span>}
                        <span className="truncate text-surface-fg">{plain?.title ?? '...'}</span>
                      </div>
                    </button>
                  </div>
                  {!selecting && isTrash && (
                    <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
                      <button
                        title="恢复"
                        onClick={(e) => {
                          e.stopPropagation();
                          void restoreNote(n.id);
                        }}
                        className="rounded bg-surface-bg p-1 text-xs text-mint-600 hover:bg-mint-50 dark:hover:bg-mint-900/30"
                      >
                        ↩️
                      </button>
                      <button
                        title="永久删除"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('永久删除后不可恢复，确认？')) void permanentDeleteNote(n.id);
                        }}
                        className="rounded bg-surface-bg p-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                      >
                        🗑️
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </nav>

      {/* 批量操作栏 */}
      {selecting && selCount > 0 && (
        <div className="border-t border-surface-border bg-surface-card p-2">
          <div className="mb-2 text-center text-xs text-surface-muted">已选 {selCount} 项</div>
          <div className="flex flex-wrap gap-1">
            {viewMode !== 'trash' && (
              <>
                <BatchBtn
                  label="📁 移动"
                  onClick={() => {
                    const fid = prompt('目标文件夹 ID（留空=未分类）：');
                    if (fid !== null) batchAction('move');
                  }}
                />
                <BatchBtn label="📌 置顶" onClick={() => batchAction('pin')} />
                <BatchBtn label="📌 取消" onClick={() => batchAction('unpin')} />
                <BatchBtn label="⭐ 收藏" onClick={() => batchAction('fav')} />
                <BatchBtn label="⭐ 取消" onClick={() => batchAction('unfav')} />
              </>
            )}
            {isTrash ? (
              <>
                <BatchBtn label="↩ 恢复" onClick={() => batchAction('restore')} variant="mint" />
                <BatchBtn
                  label="🗑️ 彻底删除"
                  onClick={() => batchAction('permdelete')}
                  variant="danger"
                />
              </>
            ) : (
              <BatchBtn label="🗑️ 删除" onClick={() => batchAction('delete')} variant="danger" />
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

function NavItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${active ? 'bg-mint-50 font-semibold text-mint-700 dark:bg-mint-900/30 dark:text-mint-300' : 'text-surface-fg hover:bg-surface-bg'}`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function BatchBtn({
  label,
  onClick,
  variant,
}: {
  label: string;
  onClick: () => void;
  variant?: 'mint' | 'danger';
}) {
  const base = `flex-1 rounded px-2 py-1 text-xs font-medium text-center transition-colors`;
  const style =
    variant === 'danger'
      ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300'
      : variant === 'mint'
        ? 'bg-mint-100 text-mint-700 hover:bg-mint-200 dark:bg-mint-900/30 dark:text-mint-300'
        : 'bg-surface-bg text-surface-fg hover:bg-surface-sunken border border-surface-border';
  return (
    <button className={`${base} ${style}`} onClick={onClick}>
      {label}
    </button>
  );
}
