import {
  useState,
  useEffect,
  useCallback,
  useRef,
  Suspense,
  lazy,
  useMemo,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, IconText, labelIcon, type IconName } from './Icon';
import { MenuItem } from './MenuItem';
import { Overview } from './Overview';
import i18n from '../lib/i18n';
import { marked } from 'marked';
import { encryptString, randomBytes, toBase64Url, wrapKey } from '@dustnote/shared';
import { useStore } from '../lib/store';
import { useModeStore } from '../lib/mode-store';
import { getDeviceId } from '../lib/device';
import { copyText } from '../lib/clipboard';
import { canReadClipboard } from '../lib/env';
import { sanitizeHtml } from '../lib/sanitize-html';
import { restoreNoteImages, replaceMissingImageRefs } from '../lib/image-store';
import type { NotePlaintext } from '../lib/store-types';
import { wikilinkExtension, extractWikilinks, buildBacklinkIndex } from '../lib/wikilinks';
import { filterSlashCommands, resolveSlashCommand, type SlashCommand } from '../lib/slash-commands';
import { storeImage } from '../lib/image-store';
import { toast } from '../lib/toast';
const NoteHistoryDialog = lazy(() =>
  import('./NoteHistoryDialog').then((m) => ({ default: m.NoteHistoryDialog }))
);
const WysiwygEditor = lazy(() =>
  import('./WysiwygEditor').then((m) => ({ default: m.WysiwygEditor }))
);

// 注册 wikilink extension（[[笔记标题]] 语法）
marked.use({ extensions: [wikilinkExtension] });

/**
 * 反链索引用的 per-note wikilinks 缓存:以明文对象为键(WeakMap),
 * 每次自动保存只有被编辑笔记的对象新建,其余笔记直接命中缓存,
 * 避免击键/保存触发全库重跑 extractWikilinks(审计 P2-3)。
 */
const wikilinksCache = new WeakMap<NotePlaintext, string[]>();
function cachedWikilinks(p: NotePlaintext): string[] {
  const hit = wikilinksCache.get(p);
  if (hit) return hit;
  const links = extractWikilinks(p.content);
  wikilinksCache.set(p, links);
  return links;
}
import {
  isImageFile,
  fileToImageDataUrl,
  buildMarkdownImage,
  insertAtCursor,
} from '../lib/image-paste';
import { VoiceInputButton } from './VoiceInputButton';
import { ConfirmDialog } from './ConfirmDialog';
import { authedFetch, shareBase } from '../lib/store-helpers';

/** 构造绝对 API 基址（Tauri 桌面端必须用绝对地址，详见 store.ts 注释） */
function shareApiBase(): string {
  const { serverUrl } = useModeStore.getState();
  return serverUrl ? `${serverUrl.replace(/\/+$/, '')}/api/v1` : '/api/v1';
}

// 联机模式「图片仅本机」提示会话级只弹一次（P0-3 止血①）
let warnedImageLocalOnly = false;

export function Editor() {
  const { t } = useTranslation();
  const selectedId = useStore((s) => s.selectedNoteId);
  const note = useStore((s) => (selectedId ? s.notes.get(selectedId) : null));
  const plain = useStore((s) => (selectedId ? s.notesPlain.get(selectedId) : null));
  const folders = useStore((s) => s.folders);
  const updateNote = useStore((s) => s.updateNote);
  const deleteNote = useStore((s) => s.deleteNote);
  const viewMode = useStore((s) => s.viewMode);
  const restoreNote = useStore((s) => s.restoreNote);
  const permanentDeleteNote = useStore((s) => s.permanentDeleteNote);
  const moveNote = useStore((s) => s.moveNote);
  const appMode = useStore((s) => s.mode);
  const saveAsTemplate = useStore((s) => s.saveAsTemplate);
  const notesPlain = useStore((s) => s.notesPlain);
  const selectNote = useStore((s) => s.selectNote);

  // 反向链接索引:per-note 结果用 WeakMap 缓存(以明文对象为键)——
  // 每次自动保存只有当前笔记对象新建,其余笔记直接命中缓存,
  // 避免击键/保存触发全库重跑 extractWikilinks(审计 P2-3)
  const backlinks = useMemo(() => {
    if (!plain?.title) return [];
    const index = buildBacklinkIndex(
      new Map(
        Array.from(notesPlain.entries()).map(([id, p]) => [
          id,
          { id, title: p.title, links: cachedWikilinks(p) },
        ])
      )
    );
    return index.get(plain.title) ?? [];
  }, [notesPlain, plain?.title]);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview' | 'split' | 'wysiwyg'>('split');
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const isTrash = viewMode === 'trash';
  /** 视图模式四档：label / tip 用字面量 t()，i18n 门禁才看得见 */
  const VIEWS = [
    {
      m: 'edit',
      k: 'editor.view_edit',
      label: t('editor.view_edit'),
      tip: t('editor.view_edit_tip'),
      ro: true,
    },
    {
      m: 'split',
      k: 'editor.view_split',
      label: t('editor.view_split'),
      tip: t('editor.view_split_tip'),
      ro: true,
    },
    {
      m: 'preview',
      k: 'editor.view_preview',
      label: t('editor.view_preview'),
      tip: t('editor.view_preview_tip'),
      ro: false,
    },
    {
      m: 'wysiwyg',
      k: 'editor.view_wysiwyg',
      label: 'WYSIWYG',
      tip: t('editor.view_wysiwyg_tip'),
      ro: true,
    },
  ] as const;
  const [showShare, setShowShare] = useState(false);
  // 右键菜单「分享」:监听全局事件打开当前笔记的分享对话框
  // 斜杠命令状态
  const [showSlash, setShowSlash] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const slashCommands = useMemo(() => filterSlashCommands(slashQuery), [slashQuery]);
  const [showHistory, setShowHistory] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPermDeleteConfirm, setShowPermDeleteConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageProcessing, setImageProcessing] = useState(false);
  // 预览/分屏渲染用内容:dustnote-img:// 引用还原为 data URL 后的 markdown
  // (image-store 的图片本体在 IndexedDB,直接 marked.parse 会渲染出空图)
  const [previewSource, setPreviewSource] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 预览/分屏渲染前还原 dustnote-img:// 引用(image-store 异步读 IndexedDB);
  // 竞态用 cancelled 标志丢弃过期结果;输入防抖 300ms(审计 P2-3:
  // 每击键全量 marked.parse+DOMPurify 在长笔记下卡顿可感)
  useEffect(() => {
    if (mode !== 'preview' && mode !== 'split') {
      setPreviewSource('');
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void restoreNoteImages(content)
        .then((restored) => {
          // P0-3：IndexedDB 查不到的引用（换 profile/清库/跨设备导入）替换为
          // 「图片未同步」占位，marked 不再输出破图/空白让用户误判数据丢失
          if (!cancelled) setPreviewSource(replaceMissingImageRefs(restored));
        })
        .catch(() => {
          if (!cancelled) setPreviewSource(content);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [content, mode]);

  // 保存进行中守卫：防止 autoSave 防抖与 Ctrl+S 立即保存并发写同一笔记
  // （并发会触发服务端 version_mismatch 409，导致后写者丢失更新）
  const savingInFlight = useRef(false);
  // render 阶段同步的当前笔记 id：用于在 autoSave effect cleanup 中
  // 判断是否发生了「切笔记」——切走时防抖窗口内的未保存输入必须立即补存，
  // 否则 title/content 被新笔记的 [plain] effect 覆盖，旧改动永久丢失
  const renderedNoteIdRef = useRef<string | null>(null);
  renderedNoteIdRef.current = note?.id ?? null;

  // 把当前笔记另存为自定义模板（仅联机模式可用）
  const handleSaveAsTemplate = useCallback(() => {
    if (!plain) return;
    const name = prompt(t('templates.save_as_prompt'), plain.title);
    if (!name) return;
    saveAsTemplate(name, { title: plain.title, content: plain.content, tags: plain.tags })
      .then(() => toast.success(t('templates.save_success')))
      .catch((err: Error) => toast.error(t('templates.save_fail', { reason: err.message })));
  }, [plain, saveAsTemplate, t]);

  // F6：记录「本地 title/content 属于哪条笔记」——用于区分「切笔记」（必须
  // 用服务端快照覆盖）与「同一笔记的 loadAll/WS 广播刷新」（notesPlain 的
  // Map 与对象身份每次重建,若无条件覆盖会吃掉防抖窗口内的未保存输入,
  // 随后自动保存再把旧值写回服务端）
  const plainAppliedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!plain) return;
    const noteId = note?.id ?? null;
    const localDirty = title !== plain.title || content !== plain.content;
    if (plainAppliedForRef.current !== noteId || !localDirty) {
      setTitle(plain.title);
      setContent(plain.content);
      plainAppliedForRef.current = noteId;
    }
    // 依赖只跟 plain：title/content 是本地输入,进依赖会造成覆盖回环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plain]);

  // 处理图片文件：压缩并插入到光标处（S-2 拖拽 / 粘贴图片）
  const handleImages = useCallback(
    async (files: File[]) => {
      const imgs = files.filter(isImageFile);
      if (imgs.length === 0) return false;
      const textarea = textareaRef.current;
      if (!textarea) return false;
      setImageProcessing(true);
      try {
        for (const file of imgs) {
          try {
            const { dataUrl, alt } = await fileToImageDataUrl(file);
            let md: string;
            try {
              // 存完整 data URL（含 MIME）——此前只存 base64 段，restore 端
              // 硬编码 image/png，jpeg/webp 恢复后 MIME 错误（P0-3 顺带修复）
              const imgId = await storeImage(dataUrl);
              md = `![${alt}](dustnote-img://${imgId})`;
              // P0-3 止血①：联机模式下图片本体不随正文同步——插入当场说清楚，
              // 会话内提示一次防打扰（附件系统 v1 落地前这是数据预期管理）。
              // 用 getState 读 mode 而非闭包 appMode：本回调 deps 只 [t]，
              // 模式切换后闭包会滞留旧值。
              if (useStore.getState().mode === 'online' && !warnedImageLocalOnly) {
                warnedImageLocalOnly = true;
                toast.info(t('editor.image_local_only_notice'));
              }
            } catch {
              // IndexedDB 不可用时回退到 base64 内嵌
              md = buildMarkdownImage(dataUrl, alt);
            }
            const { value, selectionStart, selectionEnd } = insertAtCursor(textarea, md);
            setContent(value);
            // 等 React 更新 textarea 后恢复光标
            requestAnimationFrame(() => {
              textarea.selectionStart = selectionStart;
              textarea.selectionEnd = selectionEnd;
            });
          } catch (err) {
            toast.error(t('editor.image_insert_fail', { reason: (err as Error).message }));
          }
        }
        return true;
      } finally {
        setImageProcessing(false);
      }
    },
    [t]
  );

  // 斜杠命令：插入命令内容并替换 `/query`
  const insertSlashCommand = useCallback(
    (cmd: SlashCommand) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const cursorPos = ta.selectionStart;
      const val = content;
      const lineStart = val.lastIndexOf('\n', cursorPos - 1) + 1;
      const before = val.slice(0, lineStart);
      const after = val.slice(cursorPos);
      const resolved = resolveSlashCommand(cmd.insert);
      const next = before + resolved + after;
      setContent(next);
      setShowSlash(false);
      // 恢复光标到插入内容末尾
      requestAnimationFrame(() => {
        const newPos = lineStart + resolved.length;
        ta.selectionStart = newPos;
        ta.selectionEnd = newPos;
        ta.focus();
      });
    },
    [content]
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.dataTransfer.files);
      if (files.some(isImageFile)) {
        e.preventDefault();
        void handleImages(files);
      }
    },
    [handleImages]
  );

  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.clipboardData.files);
      if (files.some(isImageFile)) {
        e.preventDefault();
        void handleImages(files);
      }
    },
    [handleImages]
  );

  // 在光标处插入文本（供语音输入复用）
  const insertTextAtCursor = useCallback((text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setContent((c) => c + text);
      return;
    }
    const { value, selectionStart, selectionEnd } = insertAtCursor(textarea, text);
    setContent(value);
    requestAnimationFrame(() => {
      textarea.selectionStart = selectionStart;
      textarea.selectionEnd = selectionEnd;
      textarea.focus();
    });
  }, []);

  // B-9 剪贴板/URL 模板：读取剪贴板，识别 URL 则生成书签格式
  // 读剪贴板是安全上下文专属 API（无降级方案），HTTP 直连时预检并提示
  const insertFromClipboard = useCallback(async () => {
    if (!canReadClipboard) {
      toast.info(t('editor.clipboard_read_insecure'));
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast.info(t('editor.clipboard_empty'));
        return;
      }
      const isUrl = /^https?:\/\/\S+$/i.test(text.trim());
      if (isUrl) {
        insertTextAtCursor(`🔗 [${text.trim()}](${text.trim()})\n`);
      } else {
        insertTextAtCursor(text);
      }
      toast.success(t('editor.clipboard_inserted'));
    } catch {
      toast.error(t('editor.clipboard_read_fail'));
    }
  }, [insertTextAtCursor, t]);

  // ========== Markdown 格式辅助（格式工具栏） ==========
  // 在 textarea 光标处包裹选区；无选区时插入占位文本
  const wrapSelection = useCallback(
    (before: string, after: string, placeholder = '') => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const { selectionStart, selectionEnd } = textarea;
      const sel = content.slice(selectionStart, selectionEnd);
      const insert = sel ? `${before}${sel}${after}` : `${before}${placeholder}${after}`;
      const next = content.slice(0, selectionStart) + insert + content.slice(selectionEnd);
      setContent(next);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.selectionStart = selectionStart + before.length;
        textarea.selectionEnd =
          selectionStart + before.length + (sel ? sel.length : placeholder.length);
      });
    },
    [content]
  );

  // 在当前行首插入前缀（列表 / 引用）
  const insertLinePrefix = useCallback(
    (prefix: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const { selectionStart, selectionEnd } = textarea;
      const lineStart = content.lastIndexOf('\n', selectionStart - 1) + 1;
      const lineEnd = content.indexOf('\n', selectionEnd);
      const end = lineEnd === -1 ? content.length : lineEnd;
      const next =
        content.slice(0, lineStart) + prefix + content.slice(lineStart, end) + content.slice(end);
      setContent(next);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.selectionStart = selectionStart + prefix.length;
        textarea.selectionEnd = selectionEnd + prefix.length;
      });
    },
    [content]
  );

  // 在光标处插入整块（代码块等）
  const insertBlock = useCallback(
    (prefix: string, suffix = '\n') => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const { selectionStart, selectionEnd } = textarea;
      const text = prefix + suffix;
      const next = content.slice(0, selectionStart) + text + content.slice(selectionEnd);
      setContent(next);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.selectionStart = selectionStart + prefix.length;
        textarea.selectionEnd = selectionStart + prefix.length;
      });
    },
    [content]
  );

  // 回收站视图强制只读预览
  useEffect(() => {
    if (viewMode === 'trash' && mode !== 'preview') setMode('preview');
  }, [viewMode, mode]);

  // 防抖自动保存（回收站笔记不自动保存）
  const autoSave = useCallback(() => {
    if (savingInFlight.current) return;
    if (title !== plain?.title || content !== plain?.content) {
      savingInFlight.current = true;
      setSaving(true);
      void updateNote(note!.id, { title, content }).finally(() => {
        savingInFlight.current = false;
        setSaving(false);
      });
    }
  }, [title, content, plain, note, updateNote]);

  useEffect(() => {
    if (!note) return;
    if (viewMode === 'trash') return;
    const t = setTimeout(autoSave, 800);
    return () => {
      clearTimeout(t);
      // 切笔记（渲染出的 note id 已改变）时，防抖窗口内的未保存输入立即补存，
      // 避免被新笔记的 [plain] effect 覆盖而静默丢失
      if (renderedNoteIdRef.current !== note.id && !savingInFlight.current) {
        if (title !== plain?.title || content !== plain?.content) {
          savingInFlight.current = true;
          void updateNote(note.id, { title, content }).finally(() => {
            savingInFlight.current = false;
          });
        }
      }
    };
  }, [autoSave, note, viewMode, title, content, plain, updateNote]);

  // beforeunload：防抖窗口内（默认 800ms）的未保存修改丢失
  // 自动保存会兜底，但用户在 800ms 内关闭窗口/刷新会丢内容，这里再拦一道
  useEffect(() => {
    const dirty = title !== plain?.title || content !== plain?.content;
    if (!dirty || viewMode === 'trash') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = t('editor.unsaved_warning');
      return e.returnValue;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [title, content, plain, viewMode, t]);

  // Ctrl+S 立即保存（绕过防抖，由 use-keyboard-shortcuts 派发 editor:save-now 事件）
  useEffect(() => {
    const saveNow = () => {
      if (savingInFlight.current) return;
      if (note && plain && (title !== plain.title || content !== plain.content)) {
        savingInFlight.current = true;
        setSaving(true);
        void updateNote(note.id, { title, content }).finally(() => {
          savingInFlight.current = false;
          setSaving(false);
        });
      }
    };
    window.addEventListener('editor:save-now', saveNow);
    const onShareCurrent = (e: Event) => {
      const detail = (e as CustomEvent<{ id?: string }>).detail;
      if (!detail?.id || detail.id !== note?.id) return;
      setShowShare(true);
    };
    window.addEventListener('app:share-current', onShareCurrent);
    const offShare = () => window.removeEventListener('app:share-current', onShareCurrent);
    return () => {
      window.removeEventListener('editor:save-now', saveNow);
      offShare();
    };
  }, [note, plain, title, content, updateNote]);

  if (!note || !plain) {
    // 兜底：笔记被删 / 明文还没解出来时回落到概览，而不是白屏
    // （正常路径下 Stage 已经按状态机分了态，见 components/Stage.tsx）
    return (
      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-bg">
        <Overview />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-bg">
      {/* 工具栏三段式（§2.1）：左 = 视图模式 · 中 = 格式 · 右 = 状态与动作。
          改造前是一整排 flex-wrap 按钮，图标全是写在 JSX 里的 emoji：
          没有分组也没有主次，且彩色位图不吃 currentColor，暗色下比正文还亮。 */}
      <div className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-surface-border bg-surface-card px-3">
        {/* 左：视图模式（选中实底） */}
        <div
          role="group"
          aria-label={t('editor.view_group_aria')}
          className="flex flex-shrink-0 items-center gap-0.5 rounded-lg bg-surface-bg p-0.5"
        >
          {VIEWS.map((v) => {
            const on = mode === v.m;
            const off = v.ro && isTrash;
            return (
              <button
                key={v.k}
                onClick={() => setMode(v.m)}
                disabled={off}
                aria-pressed={on}
                title={v.tip}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                  on
                    ? 'bg-accent-strong font-semibold text-white'
                    : 'text-surface-muted hover:bg-surface-bg hover:text-surface-fg'
                } ${off ? 'cursor-not-allowed opacity-40' : ''}`}
              >
                <Icon name={labelIcon(v.k) ?? 'pencil'} size={14} />
                <span className="hidden md:inline">{v.label}</span>
              </button>
            );
          })}
        </div>

        {/* 中：Markdown 格式工具（只在能改文本的模式出现） */}
        {!isTrash && (mode === 'edit' || mode === 'split') && (
          <div
            role="group"
            aria-label={t('editor.format_group_aria')}
            className="hidden flex-shrink-0 items-center gap-0.5 sm:flex"
          >
            <FmtBtn
              icon="bold"
              title={t('editor.format_bold')}
              onClick={() => wrapSelection('**', '**', t('editor.fmt_bold_text'))}
            />
            <FmtBtn
              icon="italic"
              title={t('editor.format_italic')}
              onClick={() => wrapSelection('*', '*', t('editor.fmt_italic_text'))}
            />
            <FmtBtn
              icon="link"
              title={t('editor.format_link')}
              onClick={() => wrapSelection('[', '](url)', t('editor.fmt_link_text'))}
            />
            <FmtBtn
              icon="list"
              title={t('editor.format_list')}
              onClick={() => insertLinePrefix('- ')}
            />
            <FmtBtn
              icon="quote"
              title={t('editor.format_quote')}
              onClick={() => insertLinePrefix('> ')}
            />
            <FmtBtn
              icon="code-block"
              title={t('editor.format_code')}
              onClick={() => insertBlock('```\n', '\n```\n')}
            />
          </div>
        )}

        {/* 右：状态（12px 次要色，与动作分离）+ 常驻动作 + ⋯ 溢出 */}
        <div className="ml-auto flex flex-shrink-0 items-center gap-1">
          {isTrash ? (
            <>
              <span className="hidden items-center gap-1 rounded bg-warning-soft px-2 py-1 text-xs text-warning md:inline-flex">
                <Icon name="trash" size={14} />
                {t('editor.trash_readonly')}
              </span>
              <button
                onClick={() => void restoreNote(note.id)}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-accent-text hover:bg-accent-soft/50"
                title={t('editor.restore')}
              >
                <Icon name="refresh" size={14} />
                <span className="hidden sm:inline">{t('editor.restore')}</span>
              </button>
              <Overflow label={t('editor.more')} open={showMore} setOpen={setShowMore}>
                <MenuItem
                  k="editor.perm_delete"
                  danger
                  onClick={() => setShowPermDeleteConfirm(true)}
                />
              </Overflow>
            </>
          ) : (
            <>
              <span
                className="hidden min-w-14 items-center gap-1 text-xs text-surface-muted lg:inline-flex"
                aria-live="polite"
              >
                <Icon
                  name={imageProcessing ? 'download' : saving ? 'refresh' : 'shield-check'}
                  size={14}
                />
                <span className="truncate">
                  {imageProcessing
                    ? t('editor.image_processing')
                    : saving
                      ? t('editor.saving')
                      : title
                        ? t('editor.save_indicator')
                        : ''}
                </span>
              </span>
              <ActBtn
                icon="pin"
                label={t('editor.pin')}
                on={!!note.isPinned}
                onClick={() => void updateNote(note.id, { isPinned: !note.isPinned })}
              />
              <ActBtn
                icon="star"
                label={t('editor.favorite')}
                on={!!note.isFavorite}
                onClick={() => void updateNote(note.id, { isFavorite: !note.isFavorite })}
              />
              <Overflow
                icon="folder"
                label={t('editor.move_folder')}
                open={showMoveMenu}
                setOpen={setShowMoveMenu}
                align="right"
              >
                {folders.length === 0 && (
                  <p className="px-3 py-1.5 text-xs text-surface-muted">{t('editor.no_folders')}</p>
                )}
                {folders.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      void moveNote(note.id, f.id);
                      setShowMoveMenu(false);
                    }}
                    className={`flex w-full items-center gap-2 truncate px-3 py-1.5 text-left text-xs hover:bg-surface-bg ${
                      note.folderId === f.id ? 'font-semibold text-accent-text' : 'text-surface-fg'
                    }`}
                  >
                    <Icon name="folder" size={14} />
                    {f.name}
                  </button>
                ))}
              </Overflow>
              <ActBtn
                icon="share"
                label={t('editor.share')}
                on={false}
                onClick={() => setShowShare(true)}
              />
              <VoiceInputButton onInsert={insertTextAtCursor} />
              <Overflow label={t('editor.more')} open={showMore} setOpen={setShowMore}>
                {appMode === 'online' && (
                  <MenuItem k="history.open" onClick={() => setShowHistory(true)} />
                )}
                {appMode === 'online' && (
                  <MenuItem k="templates.save_as" onClick={() => void handleSaveAsTemplate()} />
                )}
                <MenuItem k="editor.insert_clipboard" onClick={() => void insertFromClipboard()} />
                <div className="my-1 border-t border-surface-border" />
                <MenuItem k="editor.delete" danger onClick={() => setShowDeleteConfirm(true)} />
              </Overflow>
            </>
          )}
        </div>
      </div>

      {/* 阅读纸张（§2.1）：正文 68ch + 88px 内边距，落在 glass-2 上。
          改造前正文直接铺满整个舞台宽度，一行能排到 130 个汉字 —— 那不是阅读，是扫描。 */}
      <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-5">
        <div
          className={`paper-sheet glass-2 bg-surface-card ${mode === 'split' ? 'paper-sheet--split' : ''}`}
        >
          {/* 标题 */}
          <div className="flex-shrink-0 border-b border-surface-border pb-3 pt-1">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('editor.placeholder')}
              aria-label={t('editor.placeholder')}
              disabled={isTrash}
              className="w-full bg-transparent text-2xl font-bold text-surface-fg placeholder-surface-muted focus:outline-none"
            />
          </div>

          {/* 内容 */}
          {/* 内容 */}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {mode === 'wysiwyg' ? (
              <Suspense
                fallback={
                  <div className="flex flex-1 items-center justify-center text-surface-muted">
                    {t('common.loading')}
                  </div>
                }
              >
                <WysiwygEditor
                  content={content}
                  onChange={setContent}
                  placeholder={t('editor.md_placeholder')}
                />
              </Suspense>
            ) : (
              <>
                {(mode === 'edit' || mode === 'split') && (
                  <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                    <textarea
                      ref={textareaRef}
                      value={content}
                      onChange={(e) => {
                        const val = e.target.value;
                        setContent(val);
                        const ta = e.target as HTMLTextAreaElement;
                        const cursorPos = ta.selectionStart;
                        const lineStart = val.lastIndexOf('\n', cursorPos - 1) + 1;
                        const linePrefix = val.slice(lineStart, cursorPos);
                        if (linePrefix.startsWith('/') && !linePrefix.includes(' ')) {
                          setShowSlash(true);
                          setSlashQuery(linePrefix.slice(1));
                          setSlashIndex(0);
                        } else {
                          setShowSlash(false);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (!showSlash) return;
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setSlashIndex((i) => Math.min(i + 1, slashCommands.length - 1));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setSlashIndex((i) => Math.max(i - 1, 0));
                        } else if (e.key === 'Enter' || e.key === 'Tab') {
                          if (slashCommands.length > 0) {
                            e.preventDefault();
                            insertSlashCommand(slashCommands[slashIndex]!);
                          }
                        } else if (e.key === 'Escape') {
                          setShowSlash(false);
                        }
                      }}
                      onDrop={onDrop}
                      onPaste={onPaste}
                      placeholder={t('editor.md_placeholder')}
                      aria-label={t('editor.md_placeholder')}
                      className={`editor-textarea flex-1 resize-none bg-transparent py-4 text-sm text-surface-fg placeholder-surface-muted focus:outline-none ${mode === 'split' ? 'border-r border-surface-border' : ''}`}
                    />
                    {showSlash && slashCommands.length > 0 && (
                      <div className="glass-2 absolute bottom-4 left-6 z-50 max-h-60 w-64 overflow-y-auto rounded-xl border border-surface-border bg-surface-card py-1 shadow-xl">
                        {slashCommands.map((cmd, i) => (
                          <button
                            key={cmd.id}
                            onClick={() => insertSlashCommand(cmd)}
                            onMouseEnter={() => setSlashIndex(i)}
                            className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${i === slashIndex ? 'bg-accent-soft/60 text-accent-strong dark:bg-accent/30 dark:text-accent-text' : 'text-surface-fg hover:bg-surface-bg'}`}
                          >
                            <span className="text-base">{cmd.icon}</span>
                            <div className="flex-1 truncate">
                              <div className="font-medium">
                                {i18n.language === 'en' ? cmd.labelEn : cmd.label}
                              </div>
                              <div className="text-xs text-surface-muted">
                                {i18n.language === 'en' ? cmd.descriptionEn : cmd.description}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {(mode === 'preview' || mode === 'split') && (
                  <div
                    className="min-h-0 flex-1 overflow-y-auto py-4"
                    onClick={(e) => {
                      const target = (e.target as HTMLElement).closest('.wikilink');
                      if (target) {
                        const title = target.getAttribute('data-note-title');
                        if (title) {
                          const entry = Array.from(notesPlain.entries()).find(
                            ([, p]) => p.title === title
                          );
                          if (entry) selectNote(entry[0]);
                          else toast.info(t('editor.wikilink_not_found', { title }));
                        }
                      }
                    }}
                  >
                    <div
                      className="prose prose-sm max-w-none text-surface-fg dark:prose-invert"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeHtml(
                          marked.parse(
                            previewSource || content || `*${t('editor.empty_content')}*`
                          ) as string
                        ),
                      }}
                    />
                    {backlinks.length > 0 && (
                      <div className="mt-6 border-t border-surface-border pt-4">
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-muted">
                          {t('editor.backlinks')} ({backlinks.length})
                        </h3>
                        <div className="space-y-1">
                          {backlinks.map((bl) => (
                            <button
                              key={bl.sourceId}
                              onClick={() => selectNote(bl.sourceId)}
                              className="block w-full truncate rounded px-2 py-1 text-left text-sm text-accent-text hover:bg-surface-bg dark:text-accent-text"
                            >
                              📄 {bl.sourceTitle}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {showShare && (
        <ShareDialog
          noteId={note.id}
          title={title}
          content={content}
          onClose={() => setShowShare(false)}
        />
      )}

      {showHistory && (
        <Suspense fallback={null}>
          <NoteHistoryDialog
            noteId={note.id}
            currentVersion={note.version}
            onClose={() => setShowHistory(false)}
          />
        </Suspense>
      )}

      {showDeleteConfirm && (
        <ConfirmDialog
          title={t('editor.delete')}
          message={t('editor.confirm_delete')}
          confirmLabel={t('common.delete')}
          variant="danger"
          onConfirm={() => {
            void deleteNote(note.id);
            setShowDeleteConfirm(false);
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {showPermDeleteConfirm && (
        <ConfirmDialog
          title={t('editor.perm_delete')}
          message={t('editor.confirm_perm_delete')}
          confirmLabel={t('editor.perm_delete')}
          variant="danger"
          onConfirm={() => {
            void permanentDeleteNote(note.id);
            setShowPermDeleteConfirm(false);
          }}
          onCancel={() => setShowPermDeleteConfirm(false)}
        />
      )}
    </div>
  );
}

/** 格式工具：图标按钮 + 无障碍名（改造前是 B / I / 链接 / 引用 / 代码 五种写法混排） */
function FmtBtn({
  icon,
  title,
  onClick,
  disabled,
}: {
  icon: IconName;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={title}
      title={title}
      type="button"
      className="rounded p-1.5 text-surface-muted transition-colors hover:bg-surface-bg hover:text-surface-fg disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

/** 工具栏右侧的开关型动作（置顶 / 收藏）：激活态用强调色，而不是换一块琥珀底色 */
function ActBtn({
  icon,
  label,
  on,
  onClick,
}: {
  icon: IconName;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      type="button"
      className={`rounded-lg p-2 transition-colors ${
        on
          ? 'bg-accent-soft/60 text-accent-text dark:bg-accent/30'
          : 'text-surface-muted hover:bg-surface-bg hover:text-surface-fg'
      }`}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

/**
 * 溢出菜单（⋯）：把次级动作从主排收进来。
 * 改造前工具栏 13 个按钮全平铺，主次不分（§1 U-6）；删除这类不可逆动作
 * 也从"和分享长得一样的图标"变成菜单里一条标了 danger 的明确文字。
 */
function Overflow({
  icon = 'more',
  label,
  open,
  setOpen,
  align = 'right',
  children,
}: {
  icon?: IconName;
  label: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  align?: 'left' | 'right';
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        title={label}
        type="button"
        className="rounded-lg p-2 text-surface-muted transition-colors hover:bg-surface-bg hover:text-surface-fg"
      >
        <Icon name={icon} size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="menu"
            onClick={() => setOpen(false)}
            className={`glass-2 absolute top-full z-20 mt-1 min-w-48 overflow-hidden rounded-xl border border-surface-border bg-surface-card py-1 shadow-xl ${
              align === 'right' ? 'right-0' : 'left-0'
            }`}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function ShareDialog({
  noteId,
  title,
  content,
  onClose,
}: {
  noteId: string;
  title: string;
  content: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  // 有效期预设：1 天 / 7 天 / 30 天 / 永久（undefined）
  const [expiresSec, setExpiresSec] = useState<number | undefined>(undefined);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const create = useCallback(async () => {
    setSubmitting(true);
    try {
      const { accessToken, masterKey } = useStore.getState();
      if (!masterKey) {
        toast.error(t('editor.share_not_unlocked'));
        return;
      }

      // shareKey 只在本地生成，服务端永远见不到它
      const shareKey = randomBytes(32);
      const ciphertext = await encryptString(
        shareKey,
        JSON.stringify({ title: title || t('editor.new_note_default'), content })
      );
      // 用 masterKey 包装一份，好让主人换设备后还能还原出完整链接
      const wrappedShareKey = await wrapKey(masterKey, shareKey);

      // 有效期来自预设（1/7/30 天或永久），值固定合法，无需额外校验
      // 客户端预校验密码长度（与服务端 CreateShareSchema 一致：min 4）
      if (password && password.length < 4) {
        toast.error(t('editor.share_password_hint'));
        return;
      }

      const r = await authedFetch(`${shareApiBase()}/shares`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Version': __APP_VERSION__,
          'X-Client-Platform': 'web',
          'X-Client-Channel': 'stable',
          'X-Client-Device-Id': getDeviceId(),
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          noteId,
          ciphertext,
          wrappedShareKey,
          password: password || undefined,
          expiresIn: expiresSec,
        }),
      });
      const data = (await r.json()) as { token: string; error?: string; message?: string };
      if (!r.ok) {
        toast.error(t('editor.share_fail', { reason: data.message ?? data.error ?? r.statusText }));
        return;
      }
      // 密钥放 fragment：浏览器不会把 `#` 之后的内容发给服务端
      setShareUrl(`${shareBase()}/share/${data.token}#${toBase64Url(shareKey)}`);
    } catch (err) {
      // 网络异常要有提示（Q2）：try/finally 无 catch 时 void create() 的
      // rejection 成为 unhandledrejection,用户点了按钮毫无反馈
      toast.error(
        t('editor.share_fail', { reason: err instanceof Error ? err.message : String(err) })
      );
    } finally {
      setSubmitting(false);
    }
  }, [noteId, password, expiresSec, title, content, t]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-surface-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-xl font-semibold text-text-primary">{t('editor.share_title')}</h2>

        {!shareUrl ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-surface-fg">
                {t('editor.share_password')}
              </label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('editor.share_password_hint')}
                className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-surface-fg">
                {t('editor.share_expires')}
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(
                  [
                    { label: t('editor.share_expiry_1d'), value: 86400 },
                    { label: t('editor.share_expiry_7d'), value: 7 * 86400 },
                    { label: t('editor.share_expiry_30d'), value: 30 * 86400 },
                    { label: t('editor.share_expiry_forever'), value: undefined },
                  ] as { label: string; value: number | undefined }[]
                ).map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setExpiresSec(opt.value)}
                    className={`rounded-lg border-2 px-2 py-1.5 text-xs transition-colors ${
                      expiresSec === opt.value
                        ? 'border-accent bg-accent-soft/40 text-surface-fg dark:bg-accent/30'
                        : 'border-surface-border text-surface-fg hover:bg-surface-bg'
                    }`}
                    type="button"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-lg border border-surface-border px-4 py-2 text-sm text-surface-fg"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => void create()}
                disabled={submitting}
                className="flex-1 rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:bg-accent-strong-hover disabled:opacity-50"
              >
                {t('editor.share_btn')}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="text-xs font-medium text-surface-fg">{t('editor.share_link')}</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={shareUrl}
                className="flex-1 rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-xs font-mono"
              />
              <button
                onClick={() => {
                  void copyText(shareUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="rounded-lg bg-accent-strong px-3 py-2 text-xs text-white"
              >
                {copied ? (
                  <IconText k="editor.copied" label={t('editor.copied')} />
                ) : (
                  t('editor.copy_key')
                )}
              </button>
            </div>
            <p className="rounded-lg bg-warning-soft p-2 text-xs text-warning dark:bg-warning-soft dark:text-warning">
              {t('editor.key_hint')} <strong>{t('editor.key_hint_strong')}</strong>
              {t('editor.key_hint_tail')}
            </p>
            <button
              onClick={onClose}
              className="w-full rounded-lg border border-surface-border px-4 py-2 text-sm text-surface-fg"
            >
              {t('common.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
