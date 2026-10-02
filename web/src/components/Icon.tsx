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
  Apple,
  Archive,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Bold,
  Bot,
  Briefcase,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Cloud,
  CodeXml,
  Copy,
  Download,
  Ellipsis,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  History,
  Image,
  Info,
  Italic,
  KeyRound,
  Keyboard,
  Layers,
  LayoutDashboard,
  Link2,
  List,
  LoaderCircle,
  Lock,
  LockOpen,
  LogIn,
  LogOut,
  Menu,
  Mic,
  Minus,
  Monitor,
  MonitorSmartphone,
  Moon,
  NotebookText,
  Palette,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Quote,
  RefreshCw,
  Rocket,
  RotateCw,
  Save,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  SquareSplitHorizontal,
  Star,
  Stethoscope,
  Sun,
  Tablet,
  Tag,
  Trash2,
  TriangleAlert,
  Type,
  Undo2,
  Upload,
  WifiOff,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentProps } from 'react';
import {
  ICON_SOURCES,
  ICON_NAMES,
  isIconName,
  type IconGlyph,
  type IconName,
} from '@dustnote/shared';

/**
 * lucide 图形名 → 组件。
 *
 * 键类型是 `IconGlyph`（= 名字表里所有值的并集），所以**漏一个图形就是编译错误**，
 * 不会再出现"共享名字表加了图标、某一端悄悄是空的"。这正是 web 之前漂走的形态：
 * 名字表 73 条、这里的表只有 62 条，缺的那些在 web 上会渲染成空白图标且无人报错。
 */
const GLYPHS: Record<IconGlyph, LucideIcon> = {
  apple: Apple,
  archive: Archive,
  'arrow-left': ArrowLeft,
  'arrow-left-right': ArrowLeftRight,
  briefcase: Briefcase,
  'arrow-right': ArrowRight,
  bold: Bold,
  bot: Bot,
  'calendar-days': CalendarDays,
  check: Check,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'clipboard-list': ClipboardList,
  clock: Clock,
  cloud: Cloud,
  'code-xml': CodeXml,
  copy: Copy,
  download: Download,
  ellipsis: Ellipsis,
  eye: Eye,
  'file-text': FileText,
  folder: Folder,
  'folder-open': FolderOpen,
  globe: Globe,
  history: History,
  image: Image,
  info: Info,
  italic: Italic,
  'key-round': KeyRound,
  keyboard: Keyboard,
  layers: Layers,
  'layout-dashboard': LayoutDashboard,
  'link-2': Link2,
  list: List,
  'loader-circle': LoaderCircle,
  lock: Lock,
  'lock-open': LockOpen,
  'log-in': LogIn,
  'log-out': LogOut,
  menu: Menu,
  mic: Mic,
  minus: Minus,
  monitor: Monitor,
  'monitor-smartphone': MonitorSmartphone,
  moon: Moon,
  'notebook-text': NotebookText,
  palette: Palette,
  paperclip: Paperclip,
  pencil: Pencil,
  pin: Pin,
  plus: Plus,
  quote: Quote,
  'refresh-cw': RefreshCw,
  rocket: Rocket,
  'rotate-cw': RotateCw,
  save: Save,
  search: Search,
  settings: Settings,
  'share-2': Share2,
  'shield-check': ShieldCheck,
  smartphone: Smartphone,
  sparkles: Sparkles,
  'square-split-horizontal': SquareSplitHorizontal,
  star: Star,
  stethoscope: Stethoscope,
  sun: Sun,
  tablet: Tablet,
  tag: Tag,
  'trash-2': Trash2,
  'triangle-alert': TriangleAlert,
  type: Type,
  'undo-2': Undo2,
  upload: Upload,
  'wifi-off': WifiOff,
  wrench: Wrench,
  x: X,
  zap: Zap,
};

/**
 * 语义图标名 → 组件。名字与图形都由 shared/src/icons.ts 决定，三端（web / RN / 小程序）
 * 拿的是同一张表；这里只是把图形接到 lucide-react 上。
 */
export const ICONS = Object.fromEntries(
  ICON_NAMES.map((name) => [name, GLYPHS[ICON_SOURCES[name]]])
) as Record<IconName, LucideIcon>;

export type { IconName };
export interface IconProps extends Omit<ComponentProps<LucideIcon>, 'ref'> {
  name: IconName;
  /**
   * 尺寸是有限档位，不是任意数：14/16/18/20/24 是界面档（按钮内、行内、标签前），
   * 28/32/40 是展示档（模式卡、强制更新、错误页那种"图标就是主角"的位置）。
   * 留成 number 的话，全仓会长出 26/44/48 这类只有当事人知道为什么的尺寸。
   */
  size?: 14 | 16 | 18 | 20 | 24 | 28 | 32 | 40;
}

/** 16px 网格下的统一描边宽度：小尺寸略粗才看得清 */
const strokeFor = (size: number) => (size <= 16 ? 1.9 : size <= 24 ? 1.75 : 1.5);

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
  size?: 14 | 16 | 18 | 20 | 24 | 28 | 32 | 40;
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

/**
 * 「可能是图标名，也可能是历史遗留字符串」的渲染口。
 *
 * 模板与文件夹的 icon 字段是用户数据：改造前的默认值存的是 emoji，用户自建的也可能是
 * 任意字符。直接按 IconName 断言会让老数据渲染成空白，所以这里显式两条路都走。
 */
export function IconOrText({
  value,
  size = 16,
  className,
}: {
  value: string;
  size?: 14 | 16 | 18 | 20 | 24 | 28 | 32 | 40;
  className?: string;
}) {
  return isIconName(value) ? (
    <Icon name={value} size={size} className={className} />
  ) : (
    <span className={className}>{value}</span>
  );
}
