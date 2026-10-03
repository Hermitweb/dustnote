/**
 * RN 图标（图形源 = lucide-react-native，与 web 的 lucide-react 同一批图形、同一版本号）
 *
 * 为什么现在才有：改造前 RN 的"图标系统"就是散在 <Text> 里的 56 个 emoji——彩色位图
 * 不吃颜色、暗色下最亮的往往是本该退居次级的 🔒，而且安卓/iOS/微信三套 emoji 字体
 * 长得不一样。名字表来自 shared/src/icons.ts，三端同名同图；新增图标必须先加那张表，
 * 否则 pnpm ui:check 会报"某一端偷偷加了只有它有的图标"。
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
} from 'lucide-react-native';
import { type ComponentProps } from 'react';
import { Text } from 'react-native';
import { useColors } from '../theme';
import { ICON_SOURCES, isIconName, type IconGlyph, type IconName } from '@dustnote/shared';

/**
 * lucide kebab 名 → RN 组件。
 *
 * 键必须覆盖名字表里出现的每一个值；漏一个不会构建失败（Record<string, …> 太宽），
 * 所以由 pnpm ui:check 的图标名对齐检查兜住——它比对三端实际覆盖的键集合。
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

export interface IconProps extends Omit<ComponentProps<LucideIcon>, 'ref'> {
  name: IconName;
  /** 设计 px，与 web 同口径（RN 无 CSS，尺寸只能显式给） */
  size?: number;
  /** RN 没有 currentColor：调用方把主题色传进来，等价于 web 的继承文字色 */
  color?: string;
}

/** 描边随尺寸微调：小尺寸略粗才看得清，与 web 的 strokeFor 同一套规则 */
const strokeFor = (size: number) => (size <= 16 ? 1.9 : size <= 24 ? 1.75 : 1.5);

export function Icon({ name, size = 20, color, strokeWidth, ...rest }: IconProps) {
  const c = useColors();
  const Cmp = GLYPHS[ICON_SOURCES[name]];
  if (!Cmp) return null;
  return (
    <Cmp
      size={size}
      /* 没显式给色时吃主题前景：以前兜底是硬写的 #0F172A，深色档下漏传一处就是一只近黑图标 */
      color={color ?? c.fg}
      strokeWidth={strokeWidth ?? strokeFor(size)}
      {...rest}
    />
  );
}

export type { IconName };

/** 见 web 同名组件的说明：icon 字段是用户数据，可能是历史 emoji，两条路都走得通 */
export function IconOrText({
  value,
  size = 18,
  color,
}: {
  value: string;
  size?: number;
  color?: string;
}) {
  return isIconName(value) ? <Icon name={value} size={size} color={color} /> : <Text>{value}</Text>;
}
