/**
 * 统一图标出口（UI 阶段 1.1）
 *
 * 为什么要这一层：改造前界面用 **66 种 emoji、274 次**当功能图标，另混用 110 次
 * `✓ ✕ → ⌘` 文本符号。emoji 是彩色位图字体，不吃 `currentColor`，所以：
 * 暗色下 🔒 的橙色成了整屏最亮的东西（它只是个次级动作）；四端三套 emoji 字体
 * 让同一份代码有四种观感；尺寸与基线完全不可控；屏幕阅读器读出来是"锁"或乱码。
 * 见 docs/ui-optimization.md U-1 与 docs/ui-icon-map.md。
 *
 * 约定：
 * - 尺寸只有 14 / 16 / 18 / 20 / 24 五档，默认 16；
 * - 一律 `currentColor`，颜色由所在元素的文字色决定（因此能跟随主题与明暗）；
 * - 纯装饰图标默认 `aria-hidden`；**没有**相邻文字标签的图标按钮必须自己写 `aria-label`。
 */
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Bold,
  ArrowRight,
  Paperclip,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Code,
  Clock,
  Copy,
  Download,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  History,
  Italic,
  KeyRound,
  Keyboard,
  LayoutDashboard,
  Layers,
  Info,
  Link2,
  List,
  Lock,
  LockOpen,
  Menu,
  MoreHorizontal,
  Mic,
  Monitor,
  Moon,
  Notebook,
  Pencil,
  Pin,
  Plus,
  Quote,
  RefreshCw,
  RotateCw,
  Search,
  Save,
  Settings,
  Share2,
  Smartphone,
  ShieldCheck,
  Sparkles,
  SplitSquareHorizontal,
  Star,
  Sun,
  Tag,
  Trash2,
  Type,
  Upload,
  WifiOff,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentProps } from 'react';

/** 语义图标名（不用 lucide 的组件名，避免换库时全站改调用点） */
export const ICONS = {
  add: Plus,
  admin: Wrench,
  attach: Paperclip,
  bold: Bold,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'code-block': Code,
  info: Info,
  italic: Italic,
  list: List,
  more: MoreHorizontal,
  overview: LayoutDashboard,
  quote: Quote,
  archive: Archive,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  check: Check,
  clipboard: ClipboardList,
  clock: Clock,
  close: X,
  code: Pencil,
  copy: Copy,
  download: Download,
  folder: Folder,
  'folder-open': FolderOpen,
  history: History,
  keyboard: Keyboard,
  layers: Layers,
  link: Link2,
  lock: Lock,
  menu: Menu,
  mic: Mic,
  moon: Moon,
  note: FileText,
  notebook: Notebook,
  pencil: Pencil,
  pin: Pin,
  preview: Eye,
  refresh: RefreshCw,
  recovery: KeyRound,
  search: Search,
  settings: Settings,
  share: Share2,
  'shield-check': ShieldCheck,
  split: SplitSquareHorizontal,
  star: Star,
  sun: Sun,
  tag: Tag,
  template: Notebook,
  theme: Type,
  trash: Trash2,
  unlock: LockOpen,
  upload: Upload,
  warning: AlertTriangle,
  'watch-system': Monitor,
  'wifi-off': WifiOff,
  wysiwyg: Sparkles,
  zoom: Zap,
  language: Globe,
  device: Smartphone,
  save: Save,
  rotate: RotateCw,
} as const;

export type IconName = keyof typeof ICONS;

export interface IconProps extends Omit<ComponentProps<LucideIcon>, 'ref'> {
  name: IconName;
  /** 五档尺寸，默认 16 */
  size?: 14 | 16 | 18 | 20 | 24;
}

/** 16px 网格下的统一描边宽度：小尺寸略粗才看得清 */
const strokeFor = (size: number) => (size <= 16 ? 1.9 : 1.75);

export function Icon({ name, size = 16, strokeWidth, ...rest }: IconProps) {
  const Cmp = ICONS[name];
  return (
    <Cmp size={size} strokeWidth={strokeWidth ?? strokeFor(size)} aria-hidden={true} {...rest} />
  );
}
/**
 * i18n key → 图标。
 *
 * 改造前很多按钮标签把图标写在文案里（`'⚡ 分屏'`、`'🗑️ 删除'`），于是：
 * 翻译里带着图标、换图标库要改词典、暗色下 emoji 的固定配色抢走焦点、
 * 屏幕阅读器把图标读成"电池"或"锁"。现在词典只留文字，图标由这张表提供。
 * 见 docs/ui-icon-map.md §0 的 B 类。
 */
export const LABEL_ICON: Record<string, IconName> = {
  'editor.view_edit': 'pencil',
  'editor.view_split': 'split',
  'editor.view_preview': 'preview',
  'editor.view_wysiwyg': 'wysiwyg',
  'sidebar.batch.move': 'folder',
  'sidebar.batch.tag': 'tag',
  'sidebar.batch.pin': 'pin',
  'sidebar.batch.unpin': 'pin',
  'sidebar.batch.fav': 'star',
  'sidebar.batch.unfav': 'star',
  'sidebar.batch.restore': 'refresh',
  'sidebar.batch.perm_delete': 'trash',
  'sidebar.batch.delete': 'trash',
  'sidebar.exit_select': 'close',
  'shares.exit_select': 'close',
  'settings.check_update': 'refresh',
  'settings.install_pwa': 'download',
  'settings.server_url_label': 'link',
  'settings.voice_input': 'mic',
  'error_boundary.export_diagnostics': 'clipboard',
  'error_boundary.retry': 'rotate',
  'error_boundary.reload': 'refresh',
  'import_export.zip_btn': 'archive',
  'shares.title': 'link',
  'shares.batch_revoke': 'trash',
  'admin.title': 'layers',
  'admin.tab_config': 'settings',
  'admin.tab_download': 'download',
  'admin.tab_miniprogram': 'device',
  'admin.save_btn': 'save',
  'admin.download_btn': 'download',
  'migration.export_btn': 'archive',
  'migration.import_btn': 'upload',
  'editor.trash_readonly': 'trash',
  'editor.unfiled': 'note',
  'editor.copied': 'check',
  'settings.saved_ok': 'check',
  'history.open': 'history',
  'templates.save_as': 'template',
  'editor.insert_clipboard': 'attach',
  'editor.delete': 'trash',
  'editor.perm_delete': 'trash',
  'admin.mp_warning_title': 'warning',
  'sidebar.overview': 'overview',
  'sidebar.all': 'notebook',
  'sidebar.favorites': 'star',
  'sidebar.trash': 'trash',
  'sidebar.menu_rename': 'pencil',
  'sidebar.menu_move': 'folder',
  'sidebar.menu_delete': 'trash',
};

/** 取某个文案 key 应该配对的图标名（没有则不显示图标） */
export function labelIcon(key: string): IconName | undefined {
  return LABEL_ICON[key];
}

/** 「图标 + 文案」的标签：用于把原先写在 i18n 里的 emoji 拆出来 */
export function IconText({
  k,
  label,
  size = 14,
  gap = 'mr-1',
}: {
  k: string;
  label: string;
  size?: 14 | 16 | 18 | 20 | 24;
  gap?: string;
}) {
  const name = labelIcon(k);
  return (
    <>
      {name ? (
        <Icon name={name} size={size} className={`inline-block align-[-2px] ${gap}`} />
      ) : null}
      {label}
    </>
  );
}
