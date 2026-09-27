/**
 * 笔记列表的范围 / 排序 / 搜索 / 批量选择（从 Sidebar 抽出，UI 阶段 2.8）
 *
 * 抽出来的理由：笔记原先同时以两种形态存在 —— 文件夹树的叶子 + 底部平铺列表。
 * 两栏设计要求树只放导航、列表进舞台，于是"当前该看到哪些笔记"这份事实
 * 必须有一个唯一来源，而不是散在组件里。这里就是那个来源。
 *
 * 注意：只允许 NoteList 一个消费者。SearchIndex 是实例级的（ref + 重建副作用），
 * 两处同时用会各建一份索引。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from './store';
import type { NoteRow } from './store';
import { SearchIndex, type SearchHit } from './search';
import { toast } from './toast';
import { UNFILED_ID } from './store-types';

export type SortKey = 'updated' | 'title' | 'words';
const PAGE = 50;

export function useNoteScope() {
  const { t, i18n } = useTranslation();
  const notes = useStore((s) => s.notes);
  const notesPlain = useStore((s) => s.notesPlain);
  const folders = useStore((s) => s.folders);
  const selectedFolderId = useStore((s) => s.selectedFolderId);
  const selectedNoteId = useStore((s) => s.selectedNoteId);
  const viewMode = useStore((s) => s.viewMode);
  const selectedTag = useStore((s) => s.selectedTag);
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const setStageOrder = useStore((s) => s.setStageOrder);
  const selectNote = useStore((s) => s.selectNote);
  const selectFolder = useStore((s) => s.selectFolder);
  const setViewMode = useStore((s) => s.setViewMode);
  const deleteNote = useStore((s) => s.deleteNote);
  const restoreNote = useStore((s) => s.restoreNote);
  const permanentDeleteNote = useStore((s) => s.permanentDeleteNote);
  const updateNote = useStore((s) => s.updateNote);
  const moveNote = useStore((s) => s.moveNote);

  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const [searchHits, setSearchHits] = useState<Map<string, Set<string>>>(new Map());
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [pendingBatchAction, setPendingBatchAction] = useState<string | null>(null);
  const [batchConfirmMsg, setBatchConfirmMsg] = useState('');
  const [permDeleteNoteId, setPermDeleteNoteId] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const isTrash = viewMode === 'trash';
  const normalizedQuery = useMemo(() => searchQuery.trim(), [searchQuery]);
  const isUnfiledScope = selectedFolderId === UNFILED_ID;

  /* ---------- 全文搜索索引（E2EE 下服务端读不到密文，只能客户端建索引） ---------- */
  const searchIndex = useRef(new SearchIndex());
  useEffect(() => {
    searchIndex.current.rebuild(notesPlain);
  }, [notesPlain]);

  const searchResult = useMemo((): {
    orderedHits: SearchHit[] | null;
    hitsMap: Map<string, Set<string>>;
  } => {
    if (!normalizedQuery) return { orderedHits: null, hitsMap: new Map() };
    const hits = searchIndex.current.search(normalizedQuery);
    const hitsMap = new Map<string, Set<string>>();
    for (const h of hits) hitsMap.set(h.noteId, h.matchedTokens);
    return { orderedHits: hits, hitsMap };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedQuery, notesPlain]);

  useEffect(() => {
    setSearchHits(searchResult.hitsMap);
  }, [searchResult]);

  /* ---------- 文件夹范围：选中文件夹时连同后代一起展示 ---------- */
  const folderScope = useMemo(() => {
    if (!selectedFolderId || selectedFolderId === UNFILED_ID) return null;
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

  const unfiledCount = useMemo(
    () => Array.from(notes.values()).filter((n) => !n.deletedAt && n.folderId == null).length,
    [notes]
  );
  const trashCount = useMemo(
    () => Array.from(notes.values()).filter((n) => n.deletedAt).length,
    [notes]
  );

  /** 标签范围：命中标签才算在范围内（与文件夹范围互斥，见 data-slice 注释） */
  const inTag = useCallback(
    (id: string) => !selectedTag || (notesPlain.get(id)?.tags ?? []).includes(selectedTag),
    [selectedTag, notesPlain]
  );

  const inScope = useCallback(
    (n: NoteRow) =>
      isUnfiledScope
        ? n.folderId == null
        : folderScope
          ? n.folderId != null && folderScope.has(n.folderId)
          : true,
    [isUnfiledScope, folderScope]
  );

  const byView = useCallback(
    (n: NoteRow) =>
      isTrash
        ? !!n.deletedAt
        : viewMode === 'favorites'
          ? !n.deletedAt && n.isFavorite
          : !n.deletedAt,
    [isTrash, viewMode]
  );

  /** 舞台的 list / search 态与翻篇都读这一份有序集合 */
  const visibleNotes = useMemo(() => {
    if (searchResult.orderedHits) {
      return searchResult.orderedHits
        .map((h) => notes.get(h.noteId))
        .filter((n): n is NoteRow => !!n)
        .filter(byView)
        .filter(inScope)
        .filter((n) => notesPlain.has(n.id))
        .filter((n) => inTag(n.id));
    }
    const list = Array.from(notes.values()).filter((n) => byView(n) && inScope(n) && inTag(n.id));
    return list.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (sortKey === 'title') {
        const at = notesPlain.get(a.id)?.title ?? '';
        const bt = notesPlain.get(b.id)?.title ?? '';
        return at.localeCompare(bt, i18n?.language || undefined);
      }
      if (sortKey === 'words') {
        const aw = (notesPlain.get(a.id)?.content ?? '').length;
        const bw = (notesPlain.get(b.id)?.content ?? '').length;
        return bw - aw;
      }
      return b.serverUpdatedAt.localeCompare(a.serverUpdatedAt);
    });
  }, [notes, notesPlain, searchResult, sortKey, byView, inScope, inTag, i18n?.language]);

  /* ---------- 结果集交回舞台 ----------
   * 详情态会卸载 NoteList，而「‹ 3/11 ›」与 ←/→ 翻篇要的就是这份序，
   * 所以它在解析时写进 store：读正文时仍然记得自己是"从哪一列结果里进来的"。
   */
  useEffect(() => {
    setStageOrder(visibleNotes.map((n) => n.id));
  }, [visibleNotes, setStageOrder]);

  /* ---------- 渐进加载：滚到底部追加，而不是硬截断 ---------- */
  useEffect(() => {
    setVisibleCount(PAGE);
  }, [viewMode, normalizedQuery, selectedFolderId, selectedTag]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(c + PAGE, visibleNotes.length));
        }
      },
      { rootMargin: '100px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visibleNotes.length]);

  /* ---------- 批量选择 ---------- */
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

  const selectAll = useCallback(() => {
    const all = visibleNotes.length > 0 && selectedIds.size === visibleNotes.length;
    setSelectedIds(all ? new Set() : new Set(visibleNotes.map((n) => n.id)));
    setSelecting(!all);
  }, [visibleNotes, selectedIds]);

  const doBatchAction = useCallback(
    async (action: string, targetFolderId?: string | null) => {
      const ids = Array.from(selectedIds);
      if (!ids.length) return;
      let ok = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          if (action === 'delete') await deleteNote(id);
          else if (action === 'permdelete') await permanentDeleteNote(id);
          else if (action === 'restore') await restoreNote(id);
          else if (action === 'pin') await updateNote(id, { isPinned: true });
          else if (action === 'unpin') await updateNote(id, { isPinned: false });
          else if (action === 'fav') await updateNote(id, { isFavorite: true });
          else if (action === 'unfav') await updateNote(id, { isFavorite: false });
          else if (action === 'move') await moveNote(id, targetFolderId ?? null);
          else continue;
          ok++;
        } catch {
          // 失败必须计数并告知（M14）：此前静默吞掉，本地乐观更新与服务端分叉
          failed++;
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
      if (failed > 0) {
        toast.error(t('sidebar.batch_done_failed', { label: labels[action], count: ok, failed }));
        // 发现7：失败 op 的本地乐观更新不回滚，立即 loadAll 用服务端现状校正
        void useStore
          .getState()
          .loadAll()
          .catch(() => undefined);
      } else {
        toast.success(t('sidebar.batch_done', { label: labels[action], count: ok }));
      }
    },
    [selectedIds, deleteNote, permanentDeleteNote, restoreNote, updateNote, moveNote, exitSelect, t]
  );

  const batchAction = useCallback(
    async (action: string, targetFolderId?: string | null) => {
      const ids = Array.from(selectedIds);
      if (!ids.length) return;
      if (action === 'delete' || action === 'permdelete') {
        setBatchConfirmMsg(
          action === 'permdelete'
            ? t('sidebar.confirm_permdelete', { count: ids.length })
            : t('sidebar.confirm_delete', { count: ids.length })
        );
        setPendingBatchAction(action);
        return;
      }
      await doBatchAction(action, targetFolderId);
    },
    [selectedIds, doBatchAction, t]
  );

  return {
    t,
    i18n,
    updateNote,
    moveNote,
    deleteNote,
    restoreNote,
    permanentDeleteNote,
    notes,
    notesPlain,
    folders,
    selectedFolderId,
    selectedNoteId,
    viewMode,
    searchQuery,
    setSearchQuery,
    selectNote,
    selectFolder,
    setViewMode,
    sortKey,
    setSortKey,
    visibleNotes,
    visibleCount,
    loadMoreRef,
    searchHits,
    normalizedQuery,
    isTrash,
    isUnfiledScope,
    folderScope,
    unfiledCount,
    trashCount,
    selecting,
    setSelecting,
    selectedIds,
    setSelectedIds,
    toggleSelect,
    selectAll,
    exitSelect,
    batchAction,
    doBatchAction,
    showMoveDialog,
    setShowMoveDialog,
    pendingBatchAction,
    setPendingBatchAction,
    batchConfirmMsg,
    setBatchConfirmMsg,
    permDeleteNoteId,
    setPermDeleteNoteId,
  };
}

export type NoteScope = ReturnType<typeof useNoteScope>;
