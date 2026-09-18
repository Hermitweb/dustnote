/**
 * 统一线条图标（替代 emoji）
 *
 * 形状来自 shared/src/icons.ts（三端单一来源），本端用 PNG + `tintColor`
 * 着色（RN 无内联 SVG；tintColor 只对位图生效）——等价 web 版的 currentColor。
 * PNG 由 mobile/scripts/gen-icons.mjs 生成，产物已入库。
 *
 * 颜色默认取主题的 muted 档（随主题明暗自动变），可用 color 覆写。
 *
 * 用法：<Icon name="star" size={16} color={theme.accent} />
 */
import { Image } from 'react-native';
import { useColors } from '../theme';

/** PNG 资源静态映射（RN 的 require 必须是静态字面量） */
const SOURCES = {
  plus: require('../assets/icons/plus.png'),
  check: require('../assets/icons/check.png'),
  close: require('../assets/icons/close.png'),
  'chevron-left': require('../assets/icons/chevron-left.png'),
  'chevron-right': require('../assets/icons/chevron-right.png'),
  'chevron-down': require('../assets/icons/chevron-down.png'),
  'chevron-up': require('../assets/icons/chevron-up.png'),
  star: require('../assets/icons/star.png'),
  'star-filled': require('../assets/icons/star-filled.png'),
  bookmark: require('../assets/icons/bookmark.png'),
  'bookmark-filled': require('../assets/icons/bookmark-filled.png'),
  folder: require('../assets/icons/folder.png'),
  trash: require('../assets/icons/trash.png'),
  share: require('../assets/icons/share.png'),
  clock: require('../assets/icons/clock.png'),
  'file-text': require('../assets/icons/file-text.png'),
  more: require('../assets/icons/more.png'),
  search: require('../assets/icons/search.png'),
  settings: require('../assets/icons/settings.png'),
  edit: require('../assets/icons/edit.png'),
  mic: require('../assets/icons/mic.png'),
  tag: require('../assets/icons/tag.png'),
  copy: require('../assets/icons/copy.png'),
  lock: require('../assets/icons/lock.png'),
  alert: require('../assets/icons/alert.png'),
  eye: require('../assets/icons/eye.png'),
  layers: require('../assets/icons/layers.png'),
  link: require('../assets/icons/link.png'),
  refresh: require('../assets/icons/refresh.png'),
  download: require('../assets/icons/download.png'),
  'zoom-in': require('../assets/icons/zoom-in.png'),
  list: require('../assets/icons/list.png'),
  calendar: require('../assets/icons/calendar.png'),
  'clock-plus': require('../assets/icons/clock-plus.png'),
  'check-square': require('../assets/icons/check-square.png'),
  code: require('../assets/icons/code.png'),
  quote: require('../assets/icons/quote.png'),
  minus: require('../assets/icons/minus.png'),
  table: require('../assets/icons/table.png'),
} as const;

export type IconName = keyof typeof SOURCES;

export function Icon({
  name,
  size = 16,
  color,
}: {
  name: IconName;
  /** 逻辑像素（正方形，与文字基线视觉对齐） */
  size?: number;
  /** 不传则用主题 muted 色（随主题自动变） */
  color?: string;
}) {
  const c = useColors();
  return (
    <Image
      source={SOURCES[name]}
      style={{ width: size, height: size }}
      tintColor={color ?? c.muted}
      resizeMode="contain"
    />
  );
}
