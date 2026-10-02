/**
 * 图标名字表 —— 三端共用的唯一一份（lucide 为图形源）
 *
 * 为什么需要这张表：web 用 `lucide-react`、RN 用 `lucide-react-native`（官方同族移植，
 * 版本号与 web 完全一致）、小程序拿不到 React 组件——它在构建期由
 * `scripts/gen-mp-icons.mjs` 从 `lucide` 包把同一批图形渲染成 SVG 遮罩。
 * 三条渲染链路必须**同名同图**，否则"同一个动作在三端长三张脸"就会重演一遍
 * ——那正是 §U-1（图标系统 = emoji）当初要解决的东西。
 *
 * 键 = 产品语义名（界面代码里写 `folder`、`warning`，不写 lucide 的 PascalCase）；
 * 值 = lucide 的 kebab 文件名（RN 与生成器都按它取图形）。
 *
 * 新增图标的正确姿势：先在这里加一行，三端各自的映射表若缺该图形会由
 * `pnpm ui:check` 与 TS 的 Record 完备性检查报出来——不允许只在某一端偷偷加。
 */
export const ICON_SOURCES = {
  add: 'plus',
  admin: 'wrench',
  'arrow-left': 'arrow-left',
  'arrow-right': 'arrow-right',
  archive: 'archive',
  attach: 'paperclip',
  bold: 'bold',
  check: 'check',
  'chevron-left': 'chevron-left',
  'chevron-right': 'chevron-right',
  clipboard: 'clipboard-list',
  clock: 'clock',
  close: 'x',
  'code-block': 'code-xml',
  code: 'pencil',
  copy: 'copy',
  device: 'smartphone',
  download: 'download',
  folder: 'folder',
  'folder-open': 'folder-open',
  history: 'history',
  info: 'info',
  italic: 'italic',
  keyboard: 'keyboard',
  label: 'tag',
  layers: 'layers',
  language: 'globe',
  link: 'link-2',
  list: 'list',
  lock: 'lock',
  menu: 'menu',
  mic: 'mic',
  moon: 'moon',
  more: 'ellipsis',
  name: 'type',
  note: 'file-text',
  notebook: 'notebook-text',
  overview: 'layout-dashboard',
  pencil: 'pencil',
  pin: 'pin',
  preview: 'eye',
  quote: 'quote',
  refresh: 'refresh-cw',
  recovery: 'key-round',
  rotate: 'rotate-cw',
  save: 'save',
  search: 'search',
  settings: 'settings',
  share: 'share-2',
  'shield-check': 'shield-check',
  split: 'square-split-horizontal',
  star: 'star',
  sun: 'sun',
  tag: 'tag',
  template: 'notebook-text',
  theme: 'palette',
  trash: 'trash-2',
  unlock: 'lock-open',
  upload: 'upload',
  warning: 'triangle-alert',
  'watch-system': 'monitor-smartphone',
  'wifi-off': 'wifi-off',
  wysiwyg: 'sparkles',
  zoom: 'zap',
  /* 本轮为消灭 emoji 新增的图形（原先各处用 emoji 顶替） */
  cloud: 'cloud',
  desktop: 'monitor',
  export: 'log-out',
  import: 'log-in',
  image: 'image',
  key: 'key-round',
  medical: 'stethoscope',
  rocket: 'rocket',
  sparkle: 'sparkles',
  swap: 'arrow-left-right',
  timer: 'clock',
  calendar: 'calendar-days',
  minus: 'minus',
  bot: 'bot',
  briefcase: 'briefcase',
  apple: 'apple',
  tablet: 'tablet',
  /* 加载态与撤销：此前用 ⏳ / ↩ 顶替（emoji 棘轮的 U+2300 盲区） */
  loader: 'loader-circle',
  undo: 'undo-2',
} as const;

/** 产品语义名：界面代码里用的那个 */
export type IconName = keyof typeof ICON_SOURCES;
/** lucide 图形名（kebab 文件名）：RN 与小程序生成器按它取图 */
export type IconGlyph = (typeof ICON_SOURCES)[IconName];

export const ICON_NAMES = Object.keys(ICON_SOURCES) as IconName[];

/**
 * 判断一个字符串是不是合法的图标名。
 *
 * 存在的理由：模板/文件夹的 icon 字段是**用户数据**，历史行里存的是 emoji（改造前
 * 的默认值），新行存的是图标名。渲染端必须两种都吃得下，否则老用户一打开就是一片空白。
 */
export function isIconName(value: unknown): value is IconName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ICON_SOURCES, value);
}
