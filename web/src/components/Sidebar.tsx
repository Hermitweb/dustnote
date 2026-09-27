import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { UNFILED_ID } from '../lib/store-types';
import { useState, useMemo, useRef, useEffect, type DragEvent } from 'react';
import { TemplatePicker } from './TemplatePicker';
import { toast } from '../lib/toast';
import { Logo } from './Logo';
import { Icon, IconText, labelIcon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import JSZip from 'jszip';
import { exportAsMarkdown, downloadBlob, parseNoteFile, detectFormat } from '../lib/io-client';
import { restoreNoteImages } from '../lib/image-store';
import { apiErrorCode } from '@dustnote/shared';
import { errorText } from '../lib/error-text';

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
  const selectFolder = useStore((s) => s.selectFolder);
  const viewMode = useStore((s) => s.viewMode);
  const isOnline = useStore((s) => s.isOnline);
  const pendingCount = useStore((s) => s.pendingCount);
  const createFolder = useStore((s) => s.createFolder);
  const createNote = useStore((s) => s.createNote);
  const deleteFolder = useStore((s) => s.deleteFolder);
  const renameFolder = useStore((s) => s.renameFolder);
  const moveFolder = useStore((s) => s.moveFolder);
  const selectNote = useStore((s) => s.selectNote);
  const setViewMode = useStore((s) => s.setViewMode);
  const selectedTag = useStore((s) => s.selectedTag);
  const setSelectedTag = useStore((s) => s.setSelectedTag);
  const emptyTrash = useStore((s) => s.emptyTrash);
  const deleteNote = useStore((s) => s.deleteNote);
  const updateNote = useStore((s) => s.updateNote);
  const moveNote = useStore((s) => s.moveNote);
  const searchFocusToken = useStore((s) => s.searchFocusToken);

  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  /*
   * 拖拽移动笔记的投放目标（§2.1「合并的代价与对策」）。
   * 两栏之后没有"第三列的文件夹树"可以拖过去了 —— 目标改成导航轨本身：
   * 拖起来时经过哪一行，哪一行亮起来，松手即移动。
   */
  const dragNoteId = useStore((st) => st.dragNoteId);
  const setDragNoteId = useStore((st) => st.setDragNoteId);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dropProps = (folderId: string | null) => {
    const key = folderId ?? UNFILED_ID;
    return {
      onDragOver: (e: DragEvent) => {
        if (!dragNoteId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dropTarget !== key) setDropTarget(key);
      },
      onDragLeave: () => setDropTarget((cur) => (cur === key ? null : cur)),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/dustnote-note') || dragNoteId;
        setDropTarget(null);
        setDragNoteId(null);
        if (!id) return;
        void moveNote(id, folderId).then(() => toast.success(t('sidebar.moved_toast')));
      },
    };
  };
  const dropRing = (key: string) =>
    dropTarget === key ? 'ring-2 ring-accent' : dragNoteId ? 'ring-1 ring-accent/25' : '';
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
  // 确认弹窗状态（替代原生 confirm()）
  const [showEmptyTrashConfirm, setShowEmptyTrashConfirm] = useState(false);
  // 批量模式强制展开笔记列表(从文件夹头「选择」进入)
  // 搜索：E2EE 下服务端无法检索密文，必须在客户端对解密后的 notesPlain 做匹配。
  // 大小写不敏感、子串匹配 title/content/tags。空字符串 = 不过滤。
  // 搜索内容提升到 store：舞台的 search 态要读它（见 lib/stage.ts）
  const searchQuery = useStore((st) => st.searchQuery);
  const setSearchQuery = useStore((st) => st.setSearchQuery);

  // 搜索框 ref + 快捷键聚焦（Ctrl+F 触发 searchFocusToken 变化）
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchFocusToken > 0) {
      searchInputRef.current?.focus();
    }
  }, [searchFocusToken]);

  // 「未分类」虚拟节点（H8）：folderId=null 的笔记此前在 UI 永久不可见
  // （仅搜索可达）。树底显示一个入口,点击即列出这些无归属笔记。
  const unfiledCount = useMemo(
    () => Array.from(notes.values()).filter((n) => !n.deletedAt && n.folderId == null).length,
    [notes]
  );
  const isUnfiledScope = selectedFolderId === UNFILED_ID;

  /** 标签 chips：按使用次数倒序，只数未删除的笔记 */
  const tagList = useMemo(() => {
    const c = new Map<string, number>();
    for (const [id, p] of notesPlain) {
      if (notes.get(id)?.deletedAt) continue;
      for (const tag of p.tags ?? []) c.set(tag, (c.get(tag) ?? 0) + 1);
    }
    return [...c.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [notes, notesPlain]);

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
      // 服务端码在 ApiException.err.code（此前读 err.code → 恒为 undefined，
      // 该友好提示是死代码，实际一直落到下面的原始文案分支）
      if (apiErrorCode(err) === 'folder_depth_exceeded') {
        toast.error(t('sidebar.depth_limit_msg'));
      } else {
        toast.error(errorText(err));
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
      toast.error(errorText(err));
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
      toast.error(errorText(err));
    }
  };

  // 文件夹删除确认（H8）：文件夹删除是最危险的无确认操作——删除后其中的
  // 笔记失去归属,须先弹窗说明影响范围（含后代文件夹内的笔记数）
  const [folderDeleteConfirm, setFolderDeleteConfirm] = useState<{
    id: string;
    name: string;
    noteCount: number;
  } | null>(null);

  const doDeleteTarget = async () => {
    if (!ctxMenu) return;
    const target = ctxMenu.target;
    closeCtxMenu();
    try {
      if (target.type === 'folder') {
        // 统计将被波及的笔记数（含全部后代文件夹）
        const descIds = new Set<string>([target.id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const f of folders) {
            if (f.parentId && descIds.has(f.parentId) && !descIds.has(f.id)) {
              descIds.add(f.id);
              grew = true;
            }
          }
        }
        // 统计将被波及的笔记数（含全部后代文件夹;含回收站内笔记——
        // 它们的 folderId 同样被置 null,恢复后会出现在「未分类」,少报会误导）
        const noteCount = Array.from(notes.values()).filter(
          (n) => n.folderId != null && descIds.has(n.folderId)
        ).length;
        setFolderDeleteConfirm({ id: target.id, name: target.name, noteCount });
        return;
      }
      await deleteNote(target.id);
      toast.success(t('sidebar.deleted'));
    } catch (err) {
      toast.error(errorText(err));
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
        // P0-3 止血②：导出前还原 dustnote-img:// 为内联 data URL（对齐 ImportExportDialog）
        const exportContent = await restoreNoteImages(plain.content);
        const blob = exportAsMarkdown(plain.title, exportContent);
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
          // P0-3 止血②：ZIP 内每条同样还原图片引用
          const restored = await restoreNoteImages(pt.content);
          const md = restored.startsWith('#') ? restored : `# ${pt.title}\n\n${restored}`;
          zip.file(`${safeFileName(pt.title || 'untitled')}.md`, '\uFEFF' + md);
          count++;
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(blob, `${safeFileName(target.name)}.zip`);
        toast.success(t('sidebar.exported_folder', { count }));
      }
    } catch (err) {
      toast.error(errorText(err));
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

  // 两栏改造后：树只放导航，笔记列表在舞台（lib/stage.ts 的 list / search 态）。
  // 因此文件夹树在任何视图下都常驻，不再与平铺列表互斥。
  const showFolderTree = true;
  const trashCount = Array.from(notes.values()).filter((n) => n.deletedAt).length;
  const isTrash = viewMode === 'trash';

  return (
    <>
      {/* 移动端遮罩：sidebar 显示时点击空白处关闭 */}
      <div
        className="fixed inset-0 z-30 bg-black/55 backdrop-blur-[2px] lg:hidden"
        onClick={() => useStore.getState().toggleSidebar()}
        aria-hidden="true"
      />
      <aside
        role="navigation"
        aria-label={t('sidebar.title')}
        data-rail=""
        className="glass-1 fixed inset-y-0 left-0 z-40 flex h-full w-[216px] max-w-[85vw] flex-col border-r border-surface-border bg-surface-card lg:static lg:z-auto lg:max-w-none"
      >
        {/* 顶栏 */}
        <div className="border-b border-surface-border p-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft/60 dark:bg-accent/30">
              <Logo className="h-6 w-6" alt="" />
            </div>
            <h1 className="rail-label flex-1 text-base font-bold text-text-primary">
              {t('app.name')}
            </h1>
            {/* 离线徽章：断网或有待同步操作时显示 */}
            {(!isOnline || pendingCount > 0) && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning dark:bg-warning-soft dark:text-warning"
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
          <div className="flex gap-1">
            <button
              onClick={() => {
                // 主 CTA 无条件创建（用户拍板「统一」）：「未分类」视图归一为 null
                // （H-A：虚拟 id 曾直接透传，单机模式落库成不可见笔记）；
                // 未选中文件夹（重新解锁后常见；收藏/回收站/搜索视图同理）传 null
                // → data-slice 回退首文件夹，不再弹「请先选择文件夹」的死端提示。
                const target = selectedFolderId === UNFILED_ID ? null : selectedFolderId;
                void createNote(target).catch((err: unknown) => toast.error(errorText(err)));
              }}
              className="rail-center flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent-strong px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-strong-hover"
              title={t('app_bar.new_note')}
            >
              <Icon name="add" size={16} className="rail-mini-only" />
              <span className="rail-label">{t('app_bar.new_note')}</span>
            </button>
            <button
              onClick={() => setShowTemplatePicker(true)}
              className="rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-surface-fg transition-colors hover:bg-surface-3"
              title={t('templates.open')}
              aria-label={t('templates.open')}
            >
              <Icon name="template" size={16} />
            </button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {/* 搜索框：客户端全文搜索（E2EE 下服务端无法检索密文） */}
          <div className="mb-2 px-1">
            {/* 图标轨档：搜索收成一个按钮，点开才聚焦输入框（56px 放不下一整条输入框） */}
            <button
              onClick={() => useStore.getState().focusSearch()}
              aria-label={t('app_bar.search')}
              title={t('app_bar.search')}
              className="rail-mini-only w-full items-center justify-center rounded-lg border border-surface-border bg-surface-bg py-1.5 text-text-tertiary hover:bg-surface-3"
              type="button"
            >
              <Icon name="search" size={16} />
            </button>
            <div className="rail-hide-mini relative">
              <Icon
                name="search"
                size={14}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary"
              />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('app_bar.search')}
                className="w-full rounded-lg border border-surface-border bg-surface-bg py-1.5 pl-7 pr-7 text-sm text-surface-fg placeholder-surface-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                type="search"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
                  title={t('common.cancel')}
                  aria-label={t('common.cancel')}
                  type="button"
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
          </div>

          {/* 文件夹树仅在「全部笔记」视图显示（收藏/回收站/搜索时只显示对应列表，
              用户反馈：收藏视图不要显示多余文件夹） */}
          {showFolderTree && (
            <div className="group/folders mt-4">
              <div className="rail-center mb-1 flex items-center justify-between px-2">
                <span className="rail-label text-[11px] font-semibold uppercase tracking-[0.07em] text-text-secondary">
                  {t('sidebar.folders')}
                </span>
                {/* 分组操作默认不占视觉重量：hover 或键盘聚焦时才出现（§2.1） */}
                <button
                  onClick={() => {
                    setNewFolderName('');
                    setNewSubParent(null);
                    setShowNewFolder(true);
                  }}
                  className="rounded p-0.5 text-text-tertiary opacity-0 transition-opacity hover:text-accent-text focus-visible:opacity-100 group-hover/folders:opacity-100"
                  title={t('sidebar.add_folder')}
                  aria-label={t('sidebar.add_folder')}
                >
                  <Icon name="add" size={14} />
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
                    className="rounded bg-accent-strong px-2 py-1 text-xs font-medium text-white hover:bg-accent-strong-hover"
                  >
                    <Icon name="check" size={14} />
                  </button>
                  <button
                    onClick={cancelNewFolder}
                    className="rounded border border-surface-border px-2 py-1 text-xs text-surface-muted hover:bg-surface-bg"
                  >
                    <Icon name="close" size={14} />
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
                      {...dropProps(f.id)}
                      className={`group/row flex h-7 items-center rounded transition-colors ${
                        isActive ? 'bg-accent-soft/40 dark:bg-accent/30' : 'hover:bg-surface-bg'
                      } ${dropRing(f.id)}`}
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
                        className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 text-left text-sm ${
                          isActive
                            ? 'font-semibold text-accent-text dark:text-accent-text'
                            : 'text-surface-fg'
                        }`}
                      >
                        {f.icon ? (
                          <span className="flex-none">{f.icon}</span>
                        ) : (
                          <Icon name="folder" size={14} className="flex-none text-text-tertiary" />
                        )}
                        <span className="rail-label truncate">{f.name}</span>
                        {/* 计数右对齐 tabular-nums；hover 这一行时让位给行内操作，一行不同时塞三样 */}
                        {fNotes.length > 0 && (
                          <span className="ml-auto flex-none pl-1 text-xs tabular-nums text-text-secondary group-hover/row:hidden">
                            {fNotes.length}
                          </span>
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
                          className="flex-none rounded p-0.5 text-text-tertiary opacity-0 transition-opacity hover:text-accent-text focus-visible:opacity-100 group-hover/row:opacity-100"
                          title={t('sidebar.add_subfolder')}
                          aria-label={t('sidebar.add_subfolder')}
                        >
                          <Icon name="add" size={14} />
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
                          className="rounded bg-accent-strong px-2 py-1 text-xs font-medium text-white hover:bg-accent-strong-hover"
                        >
                          <Icon name="check" size={14} />
                        </button>
                        <button
                          onClick={cancelNewFolder}
                          className="rounded border border-surface-border px-2 py-1 text-xs text-surface-muted hover:bg-surface-bg"
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    )}

                    {/* 展开：直接笔记（平铺）+ 二级子文件夹 */}
                    {expanded && (
                      <>
                        {children.map((c) => {
                          const subNotes = directNotes(c.id);
                          const subExpanded = folderExpanded.has(c.id);
                          return (
                            <div key={c.id}>
                              <div
                                {...dropProps(c.id)}
                                className={`group/row flex h-7 items-center rounded pl-[19px] transition-colors hover:bg-surface-bg ${dropRing(c.id)}`}
                              >
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
                                  className={`flex min-w-0 flex-1 items-center gap-1.5 rounded pr-2 text-left text-sm ${
                                    viewMode === 'all' && selectedFolderId === c.id
                                      ? 'bg-accent-soft/40 font-semibold text-accent-text dark:bg-accent/30 dark:text-accent-text'
                                      : 'text-surface-fg'
                                  }`}
                                >
                                  {c.icon ? (
                                    <span className="flex-none">{c.icon}</span>
                                  ) : (
                                    <Icon
                                      name="folder"
                                      size={14}
                                      className="flex-none text-text-tertiary"
                                    />
                                  )}
                                  <span className="rail-label truncate">{c.name}</span>
                                  {subNotes.length > 0 && (
                                    <span className="ml-auto flex-none pl-1 text-xs tabular-nums text-text-secondary group-hover/row:hidden">
                                      {subNotes.length}
                                    </span>
                                  )}
                                </button>
                              </div>
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

              {/* 「未分类」虚拟节点（H8）：folderId=null 的笔记（含删除文件夹后
                  的归属失落笔记）在此保持可见可达,不再只靠搜索。
                  M1：folders 为空时也渲染——否则「删光全部文件夹」的用户
                  看不到任何笔记入口,顶栏新建也无处可归 */}
              {showFolderTree && (unfiledCount > 0 || folders.length === 0) && (
                <div>
                  <div
                    {...dropProps(null)}
                    className={`flex items-center rounded transition-colors ${
                      isUnfiledScope ? 'bg-accent-soft/40 dark:bg-accent/30' : 'hover:bg-surface-bg'
                    } ${dropRing(UNFILED_ID)}`}
                  >
                    <button
                      onClick={() => selectFolder(UNFILED_ID)}
                      className="flex h-7 flex-1 items-center gap-1.5 overflow-hidden px-2 text-left text-sm text-text-primary"
                      title={t('editor.unfiled')}
                    >
                      <span className="rail-label truncate">
                        <IconText k="editor.unfiled" label={t('editor.unfiled')} />
                      </span>
                      <span className="ml-auto text-xs tabular-nums text-text-secondary">
                        {unfiledCount}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* 标签 chips（§2.1 三段里的第三段）：常驻、可点，点一下就是舞台的标签范围。
              超过 8 个折叠成「+N 更多」而不是整段消失 —— 用户要的是"别占地方"，不是"看不见"。 */}
          {tagList.length > 0 && (
            <div className="group/tags mt-4">
              <div className="rail-center mb-1 flex items-center justify-between px-2">
                <span className="rail-label text-[11px] font-semibold uppercase tracking-[0.07em] text-text-secondary">
                  {t('sidebar.tags')}
                </span>
                <button
                  onClick={() => setSelectedTag(selectedTag ? null : tagList[0]!.tag)}
                  className="text-text-tertiary opacity-0 transition-opacity hover:text-accent-text focus-visible:opacity-100 group-hover/tags:opacity-100"
                  title={selectedTag ? t('sidebar.tags_clear') : t('sidebar.tags_filter')}
                  aria-pressed={!!selectedTag}
                >
                  <Icon name={selectedTag ? 'close' : 'tag'} size={14} />
                </button>
              </div>
              <div className="rail-hide-mini flex flex-wrap gap-1 px-2">
                {(tagsExpanded ? tagList : tagList.slice(0, 8)).map((tg) => {
                  const on = selectedTag === tg.tag;
                  return (
                    <button
                      key={tg.tag}
                      onClick={() => setSelectedTag(on ? null : tg.tag)}
                      aria-pressed={on}
                      title={tg.tag}
                      className={`flex h-6 max-w-full items-center gap-1 truncate rounded-full border px-2 text-xs transition-colors ${
                        on
                          ? 'border-accent bg-accent-soft/60 font-semibold text-accent-text dark:bg-accent/30'
                          : 'border-surface-border text-text-secondary hover:bg-surface-bg'
                      }`}
                    >
                      <span className="truncate">{tg.tag}</span>
                      <span className="flex-none tabular-nums text-text-secondary">{tg.count}</span>
                    </button>
                  );
                })}
                {tagList.length > 8 && (
                  <button
                    onClick={() => setTagsExpanded((v) => !v)}
                    className="flex h-6 items-center rounded-full border border-dashed border-surface-border px-2 text-xs text-text-secondary hover:bg-surface-bg"
                  >
                    {tagsExpanded ? t('sidebar.tags_collapse') : `+${tagList.length - 8}`}
                  </button>
                )}
              </div>
            </div>
          )}
          {/* 图标轨档（56px）放不下 chips：改成一枚标签按钮，点开浮层再选。
              小屏不该丢掉一条主路径 —— 收起不等于没有。 */}
          {tagList.length > 0 && (
            <div className="rail-mini-only flex justify-center px-1 pb-2">
              <button
                onClick={() => setTagSheetOpen(true)}
                aria-label={t('sidebar.tags')}
                title={t('sidebar.tags')}
                className={`rounded-md p-2 transition-colors ${
                  selectedTag
                    ? 'bg-accent-soft/60 text-accent-text dark:bg-accent/30'
                    : 'text-text-secondary hover:bg-surface-bg'
                }`}
                type="button"
              >
                <Icon name="tag" size={16} />
              </button>
            </div>
          )}
          {tagSheetOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setTagSheetOpen(false)}
                aria-hidden="true"
              />
              <div
                role="dialog"
                aria-label={t('sidebar.tags')}
                className="glass-2 fixed bottom-16 left-2 z-40 max-h-[60vh] w-56 overflow-y-auto rounded-xl border border-surface-border bg-surface-card p-2 shadow-2xl"
              >
                <div className="mb-1 flex items-center justify-between px-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-secondary">
                    {t('sidebar.tags')}
                  </span>
                  <button
                    onClick={() => setTagSheetOpen(false)}
                    aria-label={t('common.close')}
                    className="rounded p-0.5 text-text-secondary hover:bg-surface-3"
                    type="button"
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {tagList.map((tg) => {
                    const on = selectedTag === tg.tag;
                    return (
                      <button
                        key={tg.tag}
                        onClick={() => {
                          setSelectedTag(on ? null : tg.tag);
                          setTagSheetOpen(false);
                        }}
                        aria-pressed={on}
                        className={`flex h-7 max-w-full items-center gap-1 truncate rounded-full border px-2 text-xs ${
                          on
                            ? 'border-accent bg-accent-soft/60 font-semibold text-accent-text dark:bg-accent/30'
                            : 'border-surface-border text-text-secondary hover:bg-surface-bg'
                        }`}
                        type="button"
                      >
                        <span className="truncate">{tg.tag}</span>
                        <span className="flex-none tabular-nums text-text-secondary">
                          {tg.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </nav>

        {/* 目的地切换 = 舞台状态机的输入（web/src/lib/stage.ts）：
              概览 / 全部笔记 / 收藏 / 回收站。图标不再写成 emoji ——
              彩色位图不吃 currentColor，暗色下这几个字符会亮过正文。 */}
        <div className="border-t border-surface-border p-2">
          {/* 216px 的轨里四个目的地横排会互相挤到重叠：2×2 才放得下「全部笔记」 */}
          <div
            className="grid grid-cols-2 gap-1"
            role="group"
            aria-label={t('sidebar.destinations_aria')}
          >
            {(
              [
                { mode: 'overview', k: 'sidebar.overview' },
                { mode: 'all', k: 'sidebar.all' },
                { mode: 'favorites', k: 'sidebar.favorites' },
                { mode: 'trash', k: 'sidebar.trash' },
              ] as const
            ).map((d) => {
              const on = viewMode === d.mode;
              return (
                <button
                  key={d.k}
                  onClick={() => setViewMode(d.mode)}
                  aria-pressed={on}
                  title={t(d.k)}
                  className={`rail-center flex min-w-0 items-center gap-1 truncate rounded-md px-1.5 py-1.5 text-[11px] leading-none transition-colors ${
                    on
                      ? 'bg-accent-soft/40 font-semibold text-accent-text dark:bg-accent/30 dark:text-accent-text'
                      : 'text-surface-fg hover:bg-surface-bg'
                  }`}
                >
                  <Icon name={labelIcon(d.k) ?? 'note'} size={14} className="flex-none" />
                  <span className="rail-label truncate">
                    {t(d.k)}
                    {d.mode === 'trash' && trashCount > 0 ? ` (${trashCount})` : ''}
                  </span>
                </button>
              );
            })}
          </div>
          {isTrash && trashCount > 0 && (
            <button
              onClick={() => setShowEmptyTrashConfirm(true)}
              className="mt-1 w-full rounded border border-danger/30 bg-danger-soft px-2 py-1 text-xs text-danger transition-opacity hover:opacity-80"
            >
              {t('sidebar.empty_trash')}
            </button>
          )}
        </div>

        {showTemplatePicker && <TemplatePicker onClose={() => setShowTemplatePicker(false)} />}

        {/* 文件夹删除确认弹窗（H8） */}
        {folderDeleteConfirm && (
          <ConfirmDialog
            title={t('sidebar.batch.delete')}
            message={t('sidebar.folder_delete_confirm', {
              name: folderDeleteConfirm.name,
              count: folderDeleteConfirm.noteCount,
            })}
            confirmLabel={t('common.delete')}
            variant="danger"
            onConfirm={() => {
              const { id } = folderDeleteConfirm;
              setFolderDeleteConfirm(null);
              void deleteFolder(id)
                .then(() => toast.success(t('sidebar.deleted')))
                .catch((err: unknown) => toast.error(errorText(err)));
            }}
            onCancel={() => setFolderDeleteConfirm(null)}
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
                  label={
                    notes.get(ctxMenu.target.id)?.isFavorite
                      ? t('sidebar.ctx.unfavorite')
                      : t('sidebar.ctx.favorite')
                  }
                  onClick={() => {
                    const cur = notes.get(ctxMenu.target.id);
                    if (!cur) return;
                    void updateNote(cur.id, { isFavorite: !cur.isFavorite });
                    closeCtxMenu();
                  }}
                />
                <MenuItem
                  label={
                    notes.get(ctxMenu.target.id)?.isPinned
                      ? t('sidebar.ctx.unpin')
                      : t('sidebar.ctx.pin')
                  }
                  onClick={() => {
                    const cur = notes.get(ctxMenu.target.id);
                    if (!cur) return;
                    void updateNote(cur.id, { isPinned: !cur.isPinned });
                    closeCtxMenu();
                  }}
                />
                {isOnline && (
                  <MenuItem
                    label={t('sidebar.ctx.share')}
                    onClick={() => {
                      selectNote(ctxMenu.target.id);
                      closeCtxMenu();
                      window.dispatchEvent(
                        new CustomEvent('app:share-current', { detail: { id: ctxMenu.target.id } })
                      );
                    }}
                  />
                )}
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
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
          onClick={() => setRenameTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-surface-card p-4 shadow-2xl"
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
              className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-surface-fg focus:border-accent focus:outline-none"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void confirmRename()}
                className="flex-1 rounded-lg bg-accent-strong px-3 py-2 text-sm font-semibold text-white hover:bg-accent-strong-hover"
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
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
          onClick={() => setMoveTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-surface-card p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold text-surface-fg">{t('sidebar.ctx.move')}</h3>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {/* 「未分类(null)」选项已移除（H7/B2）：移到 null 的笔记会从
                  文件夹树消失,仅搜索可达——等同数据丢失 */}
              {folders
                .filter((f) => f.id !== moveTarget.id)
                .map((f) => (
                  <button
                    key={f.id}
                    onClick={() => void doMoveTarget(f.id)}
                    className="block w-full truncate rounded px-3 py-2 text-left text-sm text-surface-fg hover:bg-surface-bg"
                  >
                    <span className="flex-none">
                      {f.icon ?? (
                        <Icon name="folder" size={14} className="inline text-text-tertiary" />
                      )}
                    </span>{' '}
                    {f.name}
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
          ? 'text-danger hover:bg-danger-soft dark:hover:bg-danger-soft'
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
