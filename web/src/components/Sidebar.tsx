import { useTranslation } from 'react-i18next';
import { useStore, type NoteRow } from '../lib/store';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { TemplatePicker } from './TemplatePicker';
import { SearchIndex, highlightMatches, type SearchHit } from '../lib/search';
import { toast } from '../lib/toast';
import { Logo } from './Logo';
import { ConfirmDialog } from './ConfirmDialog';
import JSZip from 'jszip';
import { exportAsMarkdown, downloadBlob, parseNoteFile, detectFormat } from '../lib/io-client';

/** 右键菜单目标：文件夹或笔记叶子 */
type CtxTarget =
  | { type: 'folder'; id: string; name: string; parentId: string | null; depth: number }
  | { type: 'note'; id: string; name: string; folderId: string | null };

export function Sidebar() {
  const { t } = useTranslation();
  const folders = useStore((s) => s.folders);
  const notes = useStore((s) => s.notes);
  const notesPlain = useStore((s) => s.notesPlain);
  const selectedFolderId = useStore((s) => s.selectedFolderId);
  const selectedNoteId = useStore((s) => s.selectedNoteId);
  const viewMode = useStore((s) => s.viewMode);
  const isOnline = useStore((s) => s.isOnline);
  const pendingCount = useStore((s) => s.pendingCount);

  const selectFolder = useStore((s) => s.selectFolder);
  const createFolder = useStore((s) => s.createFolder);
  const createNote = useStore((s) => s.createNote);
  const deleteFolder = useStore((s) => s.deleteFolder);
  const renameFolder = useStore((s) => s.renameFolder);
  const moveFolder = useStore((s) => s.moveFolder);
  const selectNote = useStore((s) => s.selectNote);
  const setViewMode = useStore((s) => s.setViewMode);
  const permanentDeleteNote = useStore((s) => s.permanentDeleteNote);
  const emptyTrash = useStore((s) => s.emptyTrash);
  const restoreNote = useStore((s) => s.restoreNote);
  const deleteNote = useStore((s) => s.deleteNote);
  const updateNote = useStore((s) => s.updateNote);
  const moveNote = useStore((s) => s.moveNote);
  const searchFocusToken = useStore((s) => s.searchFocusToken);

  const [newFolderName, setNewFolderName] = useState('');
  // 文件夹展开态（L1 → L2 子文件夹）+ 新建输入框上下文（顶层 / 子文件夹父级）
  const [folderExpanded, setFolderExpanded] = useState<Set<string>>(new Set());
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newSubParent, setNewSubParent] = useState<string | null>(null);
  // 右键菜单 / 重命名 / 移动 / 导入
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; target: CtxTarget } | null>(null);
  const [renameTarget, setRenameTarget] = useState<CtxTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [moveTarget, setMoveTarget] = useState<CtxTarget | null>(null);
  const [importTargetFolderId, setImportTargetFolderId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  // 确认弹窗状态（替代原生 confirm()）
  const [pendingBatchAction, setPendingBatchAction] = useState<string | null>(null);
  const [batchConfirmMsg, setBatchConfirmMsg] = useState('');
  const [showEmptyTrashConfirm, setShowEmptyTrashConfirm] = useState(false);
  const [permDeleteNoteId, setPermDeleteNoteId] = useState<string | null>(null);
  // 笔记列表排序：updated（置顶+更新时间，默认）/ title / words
  const [sortKey, setSortKey] = useState<'updated' | 'title' | 'words'>('updated');
  // 搜索：E2EE 下服务端无法检索密文，必须在客户端对解密后的 notesPlain 做匹配。
  // 大小写不敏感、子串匹配 title/content/tags。空字符串 = 不过滤。
  const [searchQuery, setSearchQuery] = useState('');

  // 搜索框 ref + 快捷键聚焦（Ctrl+F 触发 searchFocusToken 变化）
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchFocusToken > 0) {
      searchInputRef.current?.focus();
    }
  }, [searchFocusToken]);

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
  const batchAction = async (action: string, targetFolderId?: string | null) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (action === 'delete' || action === 'permdelete') {
      const msg =
        action === 'permdelete'
          ? t('sidebar.confirm_permdelete', { count: ids.length })
          : t('sidebar.confirm_delete', { count: ids.length });
      // 弹样式化确认弹窗（替代原生 confirm()）
      setBatchConfirmMsg(msg);
      setPendingBatchAction(action);
      return;
    }
    await doBatchAction(action, targetFolderId);
  };

  // 确认后执行批量操作（delete / permdelete 经 ConfirmDialog 确认后调用）
  const doBatchAction = async (action: string, targetFolderId?: string | null) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
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
          await moveNote(id, targetFolderId ?? null);
          ok++;
        }
      } catch {
        /* skip */
      }
    }
    exitSelect();
    const labels: Record<string, string> = {
      delete: t('sidebar.batch.delete'),
      permdelete: t('sidebar.perm_delete'),
      restore: t('sidebar.restore'),
      pin: t('sidebar.batch.pin'),
      unpin: t('sidebar.batch.unpin'),
      fav: t('sidebar.batch.fav'),
      unfav: t('sidebar.batch.unfav'),
      move: t('sidebar.batch.move'),
    };
    toast.success(t('sidebar.batch_done', { label: labels[action], count: ok }));
  };

  // ========== 全文搜索 v2（内存倒排索引 + 中文分词） ==========
  // E2EE 下服务端无法检索密文，必须在客户端对解密后的 notesPlain 建索引。
  // 使用 Intl.Segmenter 做中文分词，标题命中权重 > 标签 > 正文。
  const searchIndex = useRef(new SearchIndex());
  // 当前查询的命中详情（noteId → matchedTokens），用于 UI 高亮
  const [searchHits, setSearchHits] = useState<Map<string, Set<string>>>(new Map());

  // notesPlain 变化时增量重建索引
  useEffect(() => {
    searchIndex.current.rebuild(notesPlain);
  }, [notesPlain]);

  // 搜索词归一化：去除首尾空格。空串表示不过滤。
  const normalizedQuery = useMemo(() => searchQuery.trim(), [searchQuery]);

  // 执行搜索：返回有序命中列表 + 高亮 token 映射
  // 依赖 notesPlain：虽然 search 只读 searchIndex.current（ref），
  // 但 notesPlain 变化时上面的 useEffect 会 rebuild 索引，这里需重新查。
  const searchResult = useMemo((): {
    orderedHits: SearchHit[] | null;
    hitsMap: Map<string, Set<string>>;
  } => {
    if (!normalizedQuery) return { orderedHits: null, hitsMap: new Map() };
    const hits = searchIndex.current.search(normalizedQuery);
    const hitsMap = new Map<string, Set<string>>();
    for (const h of hits) {
      hitsMap.set(h.noteId, h.matchedTokens);
    }
    return { orderedHits: hits, hitsMap };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedQuery, notesPlain]);

  // 同步到 state 供渲染使用（避免 useMemo 中 setState）
  useEffect(() => {
    setSearchHits(searchResult.hitsMap);
  }, [searchResult]);

  // 选中文件夹时，连同其后代（L2 子文件夹）的笔记一起展示（扁平优先）。
  // 规范：一级文件夹 → 直接平铺其下笔记与二级子文件夹。
  const folderScope = useMemo(() => {
    if (!selectedFolderId) return null;
    const set = new Set<string>([selectedFolderId]);
    const stack = [selectedFolderId];
    while (stack.length) {
      const cur = stack.pop() as string;
      for (const f of folders) {
        if (f.parentId === cur) {
          set.add(f.id);
          stack.push(f.id);
        }
      }
    }
    return set;
  }, [selectedFolderId, folders]);

  const visibleNotes = useMemo(() => {
    // 有搜索词：按相关性得分排序，并按当前视图/文件夹过滤
    if (searchResult.orderedHits) {
      const noteMap = notes;
      return searchResult.orderedHits
        .map((h) => noteMap.get(h.noteId))
        .filter((n): n is NonNullable<typeof n> => !!n)
        .filter((n) => {
          if (viewMode === 'trash') return !!n.deletedAt;
          if (viewMode === 'favorites') return !n.deletedAt && n.isFavorite;
          return !n.deletedAt;
        })
        .filter((n) => (folderScope ? n.folderId != null && folderScope.has(n.folderId) : true))
        .filter((n) => notesPlain.has(n.id));
    }

    // 无搜索词：置顶优先 + 按所选排序键排序
    const list = Array.from(notes.values())
      .filter((n) => {
        if (viewMode === 'trash') return !!n.deletedAt;
        if (viewMode === 'favorites') return !n.deletedAt && n.isFavorite;
        return !n.deletedAt;
      })
      .filter((n) => (folderScope ? n.folderId != null && folderScope.has(n.folderId) : true));
    return list.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (sortKey === 'title') {
        const at = notesPlain.get(a.id)?.title ?? '';
        const bt = notesPlain.get(b.id)?.title ?? '';
        return at.localeCompare(bt, 'zh-CN');
      }
      if (sortKey === 'words') {
        const aw = (notesPlain.get(a.id)?.content ?? '').length;
        const bw = (notesPlain.get(b.id)?.content ?? '').length;
        return bw - aw;
      }
      return b.serverUpdatedAt.localeCompare(a.serverUpdatedAt);
    });
  }, [notes, viewMode, notesPlain, searchResult, sortKey, folderScope]);

  // ========== 文件夹层级（规范：3 层封顶） ==========
  const childFolders = (pid: string) => folders.filter((f) => f.parentId === pid);
  // 某文件夹的直接笔记（未删除），按更新时间倒序平铺（规范：文件高密度平铺）
  const directNotes = (folderId: string) =>
    Array.from(notes.values())
      .filter((n) => !n.deletedAt && n.folderId === folderId)
      .sort((a, b) => b.serverUpdatedAt.localeCompare(a.serverUpdatedAt));
  // 顶层文件夹（用户自建，无预设分支）
  const topFolders = folders.filter((f) => !f.parentId);
  // 右键菜单
  const openCtxMenu = (e: React.MouseEvent, target: CtxTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, target });
  };
  // 笔记叶子（内联在文件夹树下）：点击打开编辑器
  const renderNoteLeaf = (n: NoteRow, indent: string) => {
    const plain = notesPlain.get(n.id);
    return (
      <button
        key={n.id}
        onClick={() => selectNote(n.id)}
        onContextMenu={(e) =>
          openCtxMenu(e, { type: 'note', id: n.id, name: plain?.title ?? '', folderId: n.folderId })
        }
        className={`flex w-full items-center gap-1.5 rounded py-1.5 pr-2 text-left text-sm ${indent} ${
          selectedNoteId === n.id
            ? 'bg-mint-50 font-semibold text-mint-700 dark:bg-mint-900/30 dark:text-mint-300'
            : 'text-surface-fg hover:bg-surface-bg'
        }`}
      >
        <span className="text-xs">📄</span>
        {n.isPinned && <span className="text-xs">📌</span>}
        <span className="truncate">{plain?.title ?? '...'}</span>
      </button>
    );
  };
  const toggleExpand = (id: string) =>
    setFolderExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const cancelNewFolder = () => {
    setShowNewFolder(false);
    setNewSubParent(null);
    setNewFolderName('');
  };
  const doCreateFolder = async (parentId: string | null) => {
    const name = newFolderName.trim();
    if (!name) return;
    // 深度拦截：父文件夹已到二级，禁止再建子文件夹（规范 §2.1「禁止四级及以上嵌套」）
    if (parentId) {
      const parent = folders.find((f) => f.id === parentId);
      if (parent && (parent.depth ?? 1) >= 2) {
        toast.error(t('sidebar.depth_limit_msg'));
        return;
      }
    }
    try {
      await createFolder(name, parentId ? { parentId } : undefined);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'folder_depth_exceeded') {
        toast.error(t('sidebar.depth_limit_msg'));
      } else {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    }
    cancelNewFolder();
  };

  // ========== 右键菜单动作（文件夹 / 笔记） ==========
  const closeCtxMenu = () => setCtxMenu(null);

  const confirmRename = async () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) return;
    try {
      if (renameTarget.type === 'folder') {
        await renameFolder(renameTarget.id, name);
      } else {
        const plain = notesPlain.get(renameTarget.id);
        await updateNote(renameTarget.id, { title: name, content: plain?.content ?? '' });
      }
      toast.success(t('sidebar.renamed'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
    setRenameTarget(null);
  };

  const doMoveTarget = async (targetFolderId: string | null) => {
    if (!moveTarget) return;
    const target = moveTarget;
    setMoveTarget(null);
    try {
      if (target.type === 'folder') {
        await moveFolder(target.id, targetFolderId);
      } else {
        await moveNote(target.id, targetFolderId);
      }
      toast.success(t('sidebar.moved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const doDeleteTarget = async () => {
    if (!ctxMenu) return;
    const target = ctxMenu.target;
    closeCtxMenu();
    try {
      if (target.type === 'folder') {
        await deleteFolder(target.id);
      } else {
        await deleteNote(target.id);
      }
      toast.success(t('sidebar.deleted'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const doExportTarget = async () => {
    if (!ctxMenu) return;
    const target = ctxMenu.target;
    closeCtxMenu();
    try {
      if (target.type === 'note') {
        const plain = notesPlain.get(target.id);
        if (!plain) return;
        const blob = exportAsMarkdown(plain.title, plain.content);
        downloadBlob(blob, `${safeFileName(plain.title || 'note')}.md`);
        toast.success(t('sidebar.exported'));
      } else {
        // 导出文件夹下所有笔记（含子文件夹）为一个 zip
        const scopeIds = collectFolderIds(folders, target.id);
        const zip = new JSZip();
        let count = 0;
        for (const [id, pt] of notesPlain) {
          const note = notes.get(id);
          if (!note || note.deletedAt) continue;
          if (!scopeIds.has(note.folderId ?? '')) continue;
          const md = pt.content.startsWith('#') ? pt.content : `# ${pt.title}\n\n${pt.content}`;
          zip.file(`${safeFileName(pt.title || 'untitled')}.md`, '\uFEFF' + md);
          count++;
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(blob, `${safeFileName(target.name)}.zip`);
        toast.success(t('sidebar.exported_folder', { count }));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleImportFiles = async (files: FileList | null, folderId: string | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    let ok = 0;
    for (const f of arr) {
      if (detectFormat(f.name) === 'unknown') continue;
      try {
        const pt = await parseNoteFile(f);
        const id = await createNote(folderId);
        await updateNote(id, { title: pt.title, content: pt.content });
        ok++;
      } catch {
        /* skip */
      }
    }
    if (ok > 0) toast.success(t('sidebar.imported', { count: ok }));
  };

  const trashCount = Array.from(notes.values()).filter((n) => n.deletedAt).length;
  const isTrash = viewMode === 'trash';
  const selCount = selectedIds.size;
  const hasAll = visibleNotes.length > 0 && selectedIds.size === visibleNotes.length;
  // 底部笔记列表区仅在「收藏 / 回收站 / 选中标签 / 搜索」时显示；
  // 默认（全部）不再平铺，笔记已在文件夹树下归类显示。
  const showNoteList = isTrash || viewMode === 'favorites' || !!normalizedQuery;
  // 渐进加载：初始 50 条，滚动到底部时追加 50 条（替代硬截断）
  const [visibleCount, setVisibleCount] = useState(50);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setVisibleCount(50); // 切换视图/搜索时重置
  }, [viewMode, normalizedQuery, selectedFolderId]);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !showNoteList) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(c + 50, visibleNotes.length));
        }
      },
      { rootMargin: '100px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [showNoteList, visibleNotes.length]);

  return (
    <>
      {/* 移动端遮罩：sidebar 显示时点击空白处关闭 */}
      <div
        className="fixed inset-0 z-30 bg-black/40 sm:hidden"
        onClick={() => useStore.getState().toggleSidebar()}
        aria-hidden="true"
      />
      <aside role="navigation" aria-label={t('sidebar.title') || '侧边栏'} className="fixed inset-y-0 left-0 z-40 flex h-full w-72 max-w-[85vw] flex-col border-r border-surface-border bg-surface-card sm:static sm:z-auto sm:max-w-none">
        {/* 顶栏 */}
        <div className="border-b border-surface-border p-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-mint-100 dark:bg-mint-900/30">
              <Logo className="h-6 w-6" alt="" />
            </div>
            <h1 className="flex-1 text-base font-bold text-surface-fg">{t('app.name')}</h1>
            {/* 离线徽章：断网或有待同步操作时显示 */}
            {(!isOnline || pendingCount > 0) && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                title={
                  !isOnline
                    ? `${t('sidebar.offline')} · ${pendingCount} ${t('sidebar.pending_sync')}`
                    : `${pendingCount} ${t('sidebar.pending_sync')}`
                }
              >
                {!isOnline && <span aria-hidden>⚠</span>}
                <span>
                  {!isOnline
                    ? `${t('sidebar.offline')}${pendingCount > 0 ? ` · ${pendingCount}` : ''}`
                    : `${pendingCount} ${t('sidebar.pending_sync')}`}
                </span>
              </span>
            )}
          </div>
          {!selecting && (
            <div className="flex gap-1">
              <button
                onClick={() => {
                  // 笔记必须归属文件夹：未选中文件夹时不创建（收藏/回收站/搜索
                  // 视图下 selectedFolderId 也为 null，同样引导先选文件夹）
                  if (!selectedFolderId) {
                    toast.info(t('sidebar.select_folder_first'));
                    return;
                  }
                  void createNote(selectedFolderId);
                }}
                className="flex-1 rounded-lg bg-mint-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-mint-700"
              >
                {t('app_bar.new_note')}
              </button>
              <button
                onClick={() => setShowTemplatePicker(true)}
                className="rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-surface-fg transition-colors hover:bg-surface-sunken"
                title={t('templates.open')}
                aria-label={t('templates.open')}
              >
                📋
              </button>
            </div>
          )}
          {selecting && (
            <button
              onClick={exitSelect}
              className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-surface-fg hover:bg-surface-sunken"
            >
              {t('sidebar.exit_select')}
            </button>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {/* 搜索框：客户端全文搜索（E2EE 下服务端无法检索密文） */}
          <div className="mb-2 px-1">
            <div className="relative">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-surface-muted">
                🔍
              </span>
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('app_bar.search')}
                className="w-full rounded-lg border border-surface-border bg-surface-bg py-1.5 pl-7 pr-7 text-sm text-surface-fg placeholder-surface-muted focus:border-mint-400 focus:outline-none focus:ring-1 focus:ring-mint-400"
                type="search"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-xs text-surface-muted hover:bg-surface-sunken hover:text-surface-fg"
                  title={t('common.cancel')}
                  type="button"
                >
                  ✕
                </button>
              )}
            </div>
            {normalizedQuery && (
              <p className="mt-1 px-1 text-xs text-surface-muted">
                {visibleNotes.length > 0
                  ? t('sidebar.matched', { count: visibleNotes.length })
                  : t('sidebar.no_match')}
              </p>
            )}
          </div>

          {/* 文件夹树仅在「全部笔记」视图显示（收藏/回收站/搜索时只显示对应列表，
              用户反馈：收藏视图不要显示多余文件夹） */}
          {viewMode === 'all' && (
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between px-2 text-xs font-semibold text-surface-muted">
                <span>{t('sidebar.folders')}</span>
                <button
                  onClick={() => {
                    setNewFolderName('');
                    setNewSubParent(null);
                    setShowNewFolder(true);
                  }}
                  className="text-mint-600 hover:text-mint-700"
                  title={t('sidebar.add_folder')}
                >
                  ＋
                </button>
              </div>

              {/* 新建顶层文件夹输入框 */}
              {showNewFolder && (
                <div className="mb-2 flex gap-1 px-2">
                  <input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    autoFocus
                    placeholder={t('sidebar.folder_name_placeholder')}
                    className="flex-1 rounded border border-surface-border bg-surface-bg px-2 py-1 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void doCreateFolder(null);
                      if (e.key === 'Escape') cancelNewFolder();
                    }}
                  />
                  <button
                    onClick={() => void doCreateFolder(null)}
                    className="rounded bg-mint-600 px-2 py-1 text-xs font-medium text-white hover:bg-mint-700"
                  >
                    ✓
                  </button>
                  <button
                    onClick={cancelNewFolder}
                    className="rounded border border-surface-border px-2 py-1 text-xs text-surface-muted hover:bg-surface-bg"
                  >
                    ✕
                  </button>
                </div>
              )}

              {topFolders.length === 0 && !showNewFolder && (
                <p className="px-2 text-xs text-surface-muted">{t('sidebar.empty_folders')}</p>
              )}

              {topFolders.map((f) => {
                const children = childFolders(f.id);
                const fNotes = directNotes(f.id);
                const expanded = folderExpanded.has(f.id);
                const hasContent = children.length > 0 || fNotes.length > 0;
                const isActive = viewMode === 'all' && selectedFolderId === f.id;
                return (
                  <div key={f.id}>
                    <div
                      className={`flex items-center rounded transition-colors ${
                        isActive ? 'bg-mint-50 dark:bg-mint-900/30' : 'hover:bg-surface-bg'
                      }`}
                    >
                      {hasContent && (
                        <button
                          onClick={() => toggleExpand(f.id)}
                          className="flex h-7 w-6 flex-shrink-0 items-center justify-center text-surface-muted hover:text-surface-fg"
                        >
                          <Chevron expanded={expanded} />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          selectFolder(f.id);
                          toggleExpand(f.id);
                        }}
                        onContextMenu={(e) =>
                          openCtxMenu(e, {
                            type: 'folder',
                            id: f.id,
                            name: f.name,
                            parentId: f.parentId,
                            depth: f.depth ?? 1,
                          })
                        }
                        className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm ${
                          isActive
                            ? 'font-semibold text-mint-700 dark:text-mint-300'
                            : 'text-surface-fg'
                        }`}
                      >
                        <span>{f.icon ?? '📁'}</span>
                        <span className="truncate">{f.name}</span>
                        {fNotes.length > 0 && (
                          <span className="text-xs text-surface-muted">{fNotes.length}</span>
                        )}
                      </button>
                      {/* 仅一级文件夹可建子文件夹（二级即最深层，规范 §2.1） */}
                      {(f.depth ?? 1) < 2 && (
                        <button
                          onClick={() => {
                            setNewFolderName('');
                            setShowNewFolder(false);
                            setNewSubParent(f.id);
                          }}
                          className="flex-shrink-0 px-1.5 text-xs text-mint-600 hover:text-mint-700"
                          title={t('sidebar.add_subfolder')}
                        >
                          ＋
                        </button>
                      )}
                    </div>

                    {/* 子文件夹新建输入框 */}
                    {newSubParent === f.id && (
                      <div className="mb-1 flex gap-1 px-2 pl-8">
                        <input
                          value={newFolderName}
                          onChange={(e) => setNewFolderName(e.target.value)}
                          autoFocus
                          placeholder={t('sidebar.folder_name_placeholder')}
                          className="flex-1 rounded border border-surface-border bg-surface-bg px-2 py-1 text-xs"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void doCreateFolder(f.id);
                            if (e.key === 'Escape') cancelNewFolder();
                          }}
                        />
                        <button
                          onClick={() => void doCreateFolder(f.id)}
                          className="rounded bg-mint-600 px-2 py-1 text-xs font-medium text-white hover:bg-mint-700"
                        >
                          ✓
                        </button>
                        <button
                          onClick={cancelNewFolder}
                          className="rounded border border-surface-border px-2 py-1 text-xs text-surface-muted hover:bg-surface-bg"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    {/* 展开：直接笔记（平铺）+ 二级子文件夹 */}
                    {expanded && (
                      <>
                        {fNotes.map((n) => renderNoteLeaf(n, 'pl-8'))}
                        {children.map((c) => {
                          const subNotes = directNotes(c.id);
                          const subExpanded = folderExpanded.has(c.id);
                          return (
                            <div key={c.id}>
                              <div className="flex items-center rounded pl-8 transition-colors hover:bg-surface-bg">
                                {subNotes.length > 0 && (
                                  <button
                                    onClick={() => toggleExpand(c.id)}
                                    className="flex h-7 w-6 flex-shrink-0 items-center justify-center text-surface-muted hover:text-surface-fg"
                                  >
                                    <Chevron expanded={subExpanded} />
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    selectFolder(c.id);
                                    toggleExpand(c.id);
                                  }}
                                  onContextMenu={(e) =>
                                    openCtxMenu(e, {
                                      type: 'folder',
                                      id: c.id,
                                      name: c.name,
                                      parentId: c.parentId,
                                      depth: c.depth ?? 2,
                                    })
                                  }
                                  className={`flex min-w-0 flex-1 items-center gap-1.5 rounded py-1.5 pr-2 text-left text-sm ${
                                    viewMode === 'all' && selectedFolderId === c.id
                                      ? 'bg-mint-50 font-semibold text-mint-700 dark:bg-mint-900/30 dark:text-mint-300'
                                      : 'text-surface-fg'
                                  }`}
                                >
                                  <span>{c.icon ?? '📁'}</span>
                                  <span className="truncate">{c.name}</span>
                                  {subNotes.length > 0 && (
                                    <span className="text-xs text-surface-muted">
                                      {subNotes.length}
                                    </span>
                                  )}
                                </button>
                              </div>
                              {subExpanded && subNotes.map((n) => renderNoteLeaf(n, 'pl-12'))}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                );
              })}

              {/* 未分类分组已移除：笔记必须归属文件夹（历史未分类笔记由
                  ensureDefaultContent 迁入默认文件夹） */}
            </div>
          )}

          {/* 笔记列表（仅在收藏/回收站/搜索时显示） */}
          {showNoteList && (
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between gap-2 px-2">
                <span className="text-xs font-semibold text-surface-muted">
                  {normalizedQuery
                    ? `${t('sidebar.matched')} (${visibleNotes.length})`
                    : isTrash
                      ? `${t('sidebar.trash')} (${visibleNotes.length})`
                      : `${t('sidebar.favorites')} (${visibleNotes.length})`}
                </span>
                {!isTrash && visibleNotes.length > 0 && (
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as 'updated' | 'title' | 'words')}
                    className="rounded border border-surface-border bg-surface-bg px-1 py-0.5 text-xs text-surface-fg focus:outline-none"
                    title={t('sidebar.sort_label')}
                  >
                    <option value="updated">{t('sidebar.sort_updated')}</option>
                    <option value="title">{t('sidebar.sort_title')}</option>
                    <option value="words">{t('sidebar.sort_words')}</option>
                  </select>
                )}
                {visibleNotes.length > 0 && (
                  <button
                    onClick={() => {
                      if (selecting) exitSelect();
                      else setSelecting(true);
                      toggleAll();
                    }}
                    className="text-xs text-mint-600 hover:text-mint-700"
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
                <p className="px-2 text-xs text-surface-muted">
                  {isTrash
                    ? t('sidebar.trash_empty')
                    : viewMode === 'favorites'
                      ? t('sidebar.favorites_empty')
                      : t('sidebar.notes_empty')}
                </p>
              ) : (
                visibleNotes.slice(0, visibleCount).map((n) => {
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
                            {plain ? (
                              <HighlightedTitle
                                title={plain.title}
                                matchedTokens={searchHits.get(n.id)}
                              />
                            ) : (
                              <span className="truncate text-surface-fg">...</span>
                            )}
                          </div>
                        </button>
                      </div>
                      {!selecting && isTrash && (
                        <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
                          <button
                            title={t('sidebar.restore')}
                            onClick={(e) => {
                              e.stopPropagation();
                              void restoreNote(n.id);
                            }}
                            className="rounded bg-surface-bg p-1 text-xs text-mint-600 hover:bg-mint-50 dark:hover:bg-mint-900/30"
                          >
                            ↩️
                          </button>
                          <button
                            title={t('sidebar.perm_delete')}
                            onClick={(e) => {
                              e.stopPropagation();
                              // 弹样式化确认弹窗（替代原生 confirm()）
                              setPermDeleteNoteId(n.id);
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
              {/* 渐进加载触发器：IntersectionObserver 检测到时追加更多笔记 */}
              {showNoteList && visibleCount < visibleNotes.length && (
                <div ref={loadMoreRef} className="py-2 text-center text-xs text-surface-muted">
                  {t('sidebar.load_more', { count: Math.min(50, visibleNotes.length - visibleCount) }) || `加载更多 (${visibleNotes.length - visibleCount})`}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* 视图切换：全部笔记（文件夹树）/ 收藏 / 回收站 */}
        <div className="border-t border-surface-border p-2">
          <div className="flex gap-1">
            <button
              onClick={() => setViewMode('all')}
              className={`flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded px-1.5 py-1.5 text-xs transition-colors ${
                viewMode === 'all'
                  ? 'bg-mint-50 font-semibold text-mint-700 dark:bg-mint-900/30 dark:text-mint-300'
                  : 'text-surface-fg hover:bg-surface-bg'
              }`}
            >
              <span>📋</span>
              <span>{t('sidebar.all')}</span>
            </button>
            <button
              onClick={() => setViewMode('favorites')}
              className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-sm transition-colors ${
                viewMode === 'favorites'
                  ? 'bg-mint-50 font-semibold text-mint-700 dark:bg-mint-900/30 dark:text-mint-300'
                  : 'text-surface-fg hover:bg-surface-bg'
              }`}
            >
              <span>⭐</span>
              <span>{t('sidebar.favorites')}</span>
            </button>
            <button
              onClick={() => setViewMode('trash')}
              className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-sm transition-colors ${
                viewMode === 'trash'
                  ? 'bg-mint-50 font-semibold text-mint-700 dark:bg-mint-900/30 dark:text-mint-300'
                  : 'text-surface-fg hover:bg-surface-bg'
              }`}
            >
              <span>🗑️</span>
              <span>
                {t('sidebar.trash')}
                {trashCount > 0 ? ` (${trashCount})` : ''}
              </span>
            </button>
          </div>
          {isTrash && trashCount > 0 && (
            <button
              onClick={() => setShowEmptyTrashConfirm(true)}
              className="mt-1 w-full rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
            >
              {t('sidebar.empty_trash')}
            </button>
          )}
        </div>

        {/* 批量操作栏 */}
        {selecting && selCount > 0 && (
          <div className="border-t border-surface-border bg-surface-card p-2">
            <div className="mb-2 text-center text-xs text-surface-muted">
              {t('sidebar.selected_count', { count: selCount })}
            </div>
            <div className="flex flex-wrap gap-1">
              {viewMode !== 'trash' && (
                <>
                  <BatchBtn
                    label={t('sidebar.batch.move')}
                    onClick={() => setShowMoveDialog(true)}
                  />
                  <BatchBtn label={t('sidebar.batch.pin')} onClick={() => batchAction('pin')} />
                  <BatchBtn label={t('sidebar.batch.unpin')} onClick={() => batchAction('unpin')} />
                  <BatchBtn label={t('sidebar.batch.fav')} onClick={() => batchAction('fav')} />
                  <BatchBtn label={t('sidebar.batch.unfav')} onClick={() => batchAction('unfav')} />
                </>
              )}
              {isTrash ? (
                <>
                  <BatchBtn
                    label={t('sidebar.batch.restore')}
                    onClick={() => batchAction('restore')}
                    variant="mint"
                  />
                  <BatchBtn
                    label={t('sidebar.batch.perm_delete')}
                    onClick={() => batchAction('permdelete')}
                    variant="danger"
                  />
                </>
              ) : (
                <BatchBtn
                  label={t('sidebar.batch.delete')}
                  onClick={() => batchAction('delete')}
                  variant="danger"
                />
              )}
            </div>
          </div>
        )}

        {showTemplatePicker && <TemplatePicker onClose={() => setShowTemplatePicker(false)} />}

        {showMoveDialog && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
            onClick={() => setShowMoveDialog(false)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-surface-card p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="mb-3 text-sm font-semibold text-surface-fg">
                {t('sidebar.batch.move')} ({selCount})
              </h3>
              <div className="max-h-60 space-y-1 overflow-y-auto">
                <button
                  onClick={() => {
                    void batchAction('move', null);
                    setShowMoveDialog(false);
                  }}
                  className="block w-full rounded px-3 py-2 text-left text-sm text-surface-fg hover:bg-surface-bg"
                >
                  📝 {t('editor.unfiled')}
                </button>
                {folders.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      void batchAction('move', f.id);
                      setShowMoveDialog(false);
                    }}
                    className="block w-full truncate rounded px-3 py-2 text-left text-sm text-surface-fg hover:bg-surface-bg"
                  >
                    {f.icon ?? '📁'} {f.name}
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

        {/* 批量删除/永久删除确认弹窗（替代原生 confirm()） */}
        {pendingBatchAction && (
          <ConfirmDialog
            title={
              pendingBatchAction === 'permdelete'
                ? t('sidebar.perm_delete')
                : t('sidebar.batch.delete')
            }
            message={batchConfirmMsg}
            confirmLabel={
              pendingBatchAction === 'permdelete' ? t('sidebar.perm_delete') : t('common.delete')
            }
            variant="danger"
            onConfirm={() => {
              const action = pendingBatchAction;
              setPendingBatchAction(null);
              void doBatchAction(action);
            }}
            onCancel={() => setPendingBatchAction(null)}
          />
        )}

        {/* 清空回收站确认弹窗 */}
        {showEmptyTrashConfirm && (
          <ConfirmDialog
            title={t('sidebar.empty_trash')}
            message={t('sidebar.confirm_empty_trash', { count: trashCount })}
            confirmLabel={t('sidebar.empty_trash')}
            variant="danger"
            onConfirm={() => {
              setShowEmptyTrashConfirm(false);
              void emptyTrash();
            }}
            onCancel={() => setShowEmptyTrashConfirm(false)}
          />
        )}

        {/* 单条永久删除确认弹窗 */}
        {permDeleteNoteId && (
          <ConfirmDialog
            title={t('sidebar.perm_delete')}
            message={t('sidebar.confirm_permdelete', { count: 1 })}
            confirmLabel={t('sidebar.perm_delete')}
            variant="danger"
            onConfirm={() => {
              const id = permDeleteNoteId;
              setPermDeleteNoteId(null);
              void permanentDeleteNote(id);
            }}
            onCancel={() => setPermDeleteNoteId(null)}
          />
        )}
      </aside>

      {/* 右键菜单 */}
      {ctxMenu && (
        <div
          className="fixed inset-0 z-[60]"
          onClick={closeCtxMenu}
          onContextMenu={(e) => {
            e.preventDefault();
            closeCtxMenu();
          }}
        >
          <div
            className="fixed z-[61] min-w-[180px] rounded-lg border border-surface-border bg-surface-card py-1 shadow-xl"
            style={{
              left: Math.min(ctxMenu.x, window.innerWidth - 200),
              top: Math.min(ctxMenu.y, window.innerHeight - 320),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {ctxMenu.target.type === 'folder' && (
              <>
                <MenuItem
                  label={t('sidebar.ctx.new_file')}
                  onClick={() => {
                    const id = ctxMenu.target.type === 'folder' ? ctxMenu.target.id : null;
                    closeCtxMenu();
                    if (id) void createNote(id);
                  }}
                />
                {(ctxMenu.target.depth ?? 1) < 2 && (
                  <MenuItem
                    label={t('sidebar.ctx.new_folder')}
                    onClick={() => {
                      const id = ctxMenu.target.type === 'folder' ? ctxMenu.target.id : null;
                      closeCtxMenu();
                      setNewFolderName('');
                      setShowNewFolder(false);
                      setNewSubParent(id);
                    }}
                  />
                )}
                <MenuItem
                  label={t('sidebar.ctx.import')}
                  onClick={() => {
                    const id = ctxMenu.target.type === 'folder' ? ctxMenu.target.id : null;
                    setImportTargetFolderId(id);
                    closeCtxMenu();
                    importInputRef.current?.click();
                  }}
                />
                <MenuItem
                  label={t('sidebar.ctx.rename')}
                  onClick={() => {
                    setRenameTarget(ctxMenu.target);
                    setRenameValue(ctxMenu.target.name);
                    closeCtxMenu();
                  }}
                />
                <MenuItem
                  label={t('sidebar.ctx.move')}
                  onClick={() => {
                    setMoveTarget(ctxMenu.target);
                    closeCtxMenu();
                  }}
                />
                <MenuItem label={t('sidebar.ctx.export')} onClick={() => void doExportTarget()} />
                <div className="my-1 border-t border-surface-border" />
                <MenuItem
                  label={t('sidebar.ctx.delete')}
                  danger
                  onClick={() => void doDeleteTarget()}
                />
              </>
            )}
            {ctxMenu.target.type === 'note' && (
              <>
                <MenuItem
                  label={t('sidebar.ctx.rename')}
                  onClick={() => {
                    setRenameTarget(ctxMenu.target);
                    setRenameValue(ctxMenu.target.name);
                    closeCtxMenu();
                  }}
                />
                <MenuItem
                  label={t('sidebar.ctx.move')}
                  onClick={() => {
                    setMoveTarget(ctxMenu.target);
                    closeCtxMenu();
                  }}
                />
                <MenuItem label={t('sidebar.ctx.export')} onClick={() => void doExportTarget()} />
                <div className="my-1 border-t border-surface-border" />
                <MenuItem
                  label={t('sidebar.ctx.delete')}
                  danger
                  onClick={() => void doDeleteTarget()}
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* 重命名对话框 */}
      {renameTarget && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-6"
          onClick={() => setRenameTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-surface-card p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold text-surface-fg">
              {t('sidebar.ctx.rename')}
            </h3>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirmRename();
                if (e.key === 'Escape') setRenameTarget(null);
              }}
              className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-surface-fg focus:border-mint-400 focus:outline-none"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void confirmRename()}
                className="flex-1 rounded-lg bg-mint-600 px-3 py-2 text-sm font-semibold text-white hover:bg-mint-700"
              >
                {t('common.confirm')}
              </button>
              <button
                onClick={() => setRenameTarget(null)}
                className="flex-1 rounded-lg border border-surface-border px-3 py-2 text-sm text-surface-fg hover:bg-surface-bg"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 移动对话框 */}
      {moveTarget && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-6"
          onClick={() => setMoveTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-surface-card p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold text-surface-fg">{t('sidebar.ctx.move')}</h3>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              <button
                onClick={() => void doMoveTarget(null)}
                className="block w-full rounded px-3 py-2 text-left text-sm text-surface-fg hover:bg-surface-bg"
              >
                📝 {t('editor.unfiled')}
              </button>
              {folders
                .filter((f) => f.id !== moveTarget.id)
                .map((f) => (
                  <button
                    key={f.id}
                    onClick={() => void doMoveTarget(f.id)}
                    className="block w-full truncate rounded px-3 py-2 text-left text-sm text-surface-fg hover:bg-surface-bg"
                  >
                    {f.icon ?? '📁'} {f.name}
                  </button>
                ))}
            </div>
            <button
              onClick={() => setMoveTarget(null)}
              className="mt-3 w-full rounded-lg border border-surface-border px-3 py-2 text-sm text-surface-fg hover:bg-surface-bg"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* 导入文件选择器 */}
      <input
        ref={importInputRef}
        type="file"
        accept=".md,.txt,.markdown"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleImportFiles(e.target.files, importTargetFolderId);
          e.target.value = '';
        }}
      />
    </>
  );
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left text-sm ${
        danger
          ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
          : 'text-surface-fg hover:bg-surface-bg'
      }`}
    >
      {label}
    </button>
  );
}

/** 展开箭头（加粗 SVG chevron，旋转动画，比小字符更明显） */
function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/** 清理文件名非法字符 */
function safeFileName(name: string): string {
  const s = name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '')
    .slice(0, 60);
  return s || 'untitled';
}

/** 收集某文件夹及其后代的所有 id（含自身） */
function collectFolderIds(
  folders: { id: string; parentId: string | null }[],
  rootId: string
): Set<string> {
  const set = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const f of folders) {
      if (f.parentId === cur) {
        set.add(f.id);
        stack.push(f.id);
      }
    }
  }
  return set;
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

/**
 * 高亮标题：把匹配的 token 用 <mark> 包裹。
 *
 * 使用 dangerouslySetInnerHTML 渲染 highlightMatches 的输出（已转义 HTML，
 * 只插入 <mark> 标签，XSS 安全）。
 */
function HighlightedTitle({
  title,
  matchedTokens,
}: {
  title: string;
  matchedTokens: Set<string> | undefined;
}) {
  if (!matchedTokens || matchedTokens.size === 0) {
    return <span className="truncate text-surface-fg">{title}</span>;
  }
  const html = highlightMatches(title, matchedTokens);
  return (
    <span
      className="truncate text-surface-fg"
      dangerouslySetInnerHTML={{
        __html: html,
      }}
    />
  );
}
