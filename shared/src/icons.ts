/**
 * 图标形状单一来源（三端共用）
 *
 * feather 风格：24×24 viewBox、stroke 绘制、round caps。
 * - web/desktop：`web/src/components/Icon.tsx` 直接内联 SVG（浏览器原生渲染）
 * - 微信小程序：`miniprogram/scripts/gen-icons.mjs` 从构建产物读本表，
 *   栅格化成 PNG 遮罩内联 WXSS（image 组件不支持 base64 SVG）
 * - 安卓：`mobile/scripts/gen-icons.mjs` 栅格化成 PNG，运行时 `<Image tintColor>` 着色
 *
 * 新增图标：这里加一条路径 → 跑两端生成脚本 → 在各自的 IconName 里补名字。
 * `fill: true` 的图标用实心渲染（收藏/置顶这类需要「已激活」形态）。
 */

export interface IconDef {
  /** SVG 路径（24×24 viewBox；描边色在各端注入） */
  path: string;
  /** 实心渲染（默认描边） */
  fill?: boolean;
}

export const ICON_PATHS: Record<string, IconDef> = {
  plus: { path: 'M12 5v14M5 12h14' },
  check: { path: 'M20 6L9 17l-5-5' },
  close: { path: 'M18 6L6 18M6 6l12 12' },
  'chevron-left': { path: 'M15 18l-6-6 6-6' },
  'chevron-right': { path: 'M9 18l6-6-6-6' },
  'chevron-down': { path: 'M6 9l6 6 6-6' },
  'chevron-up': { path: 'M18 15l-6-6-6 6' },
  star: {
    path: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  },
  'star-filled': {
    path: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    fill: true,
  },
  bookmark: { path: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' },
  'bookmark-filled': {
    path: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
    fill: true,
  },
  folder: { path: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' },
  trash: {
    path: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z',
  },
  share: {
    path: 'M18 5a3 3 0 1 0 0 .01M6 12a3 3 0 1 0 0 .01M18 19a3 3 0 1 0 0 .01M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98',
  },
  clock: { path: 'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0M12 6v6l4 2' },
  'file-text': {
    path: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  },
  more: {
    path: 'M12 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M19 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M5 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0',
  },
  search: { path: 'M11 11m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M21 21l-4.35-4.35' },
  settings: { path: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' },
  edit: {
    path: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
  },
  mic: {
    path: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8',
  },
  tag: {
    path: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83zM7 7h.01',
  },
  copy: {
    path: 'M9 9h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  },
  lock: {
    path: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4',
  },
  alert: {
    path: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  },
  eye: { path: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' },
  layers: { path: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
  link: {
    path: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  },
  refresh: {
    path: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  },
  download: { path: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3' },
  'zoom-in': { path: 'M11 11m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M21 21l-4.35-4.35M11 8v6M8 11h6' },
  list: { path: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' },
  // 以下为编辑器斜杠命令补充
  calendar: {
    path: 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18',
  },
  'clock-plus': { path: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2M20 18v6M17 21h6' },
  'check-square': {
    path: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  },
  code: { path: 'M16 18l6-6-6-6M8 6l-6 6 6 6' },
  quote: { path: 'M6 17h3l2-4V7H5v6h3zM14 17h3l2-4V7h-6v6h3z' },
  minus: { path: 'M5 12h14' },
  table: {
    path: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  },
};

export type SharedIconName = keyof typeof ICON_PATHS;

/** 生成完整 SVG 字符串（web 端内联用；描边/填充色由 color 注入） */
export function iconSvg(name: string, color = 'currentColor', strokeWidth = 1.9): string {
  const def = ICON_PATHS[name];
  if (!def) return '';
  const paint = def.fill
    ? `fill="${color}" stroke="none"`
    : `fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${paint}>${def.path}</svg>`;
}
