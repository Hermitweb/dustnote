/**
 * 统一线条图标（替代 emoji）
 *
 * 形状来自 shared/src/icons.ts（三端单一来源）；web 直接内联 SVG——
 * 浏览器原生渲染，颜色走 currentColor，随主题/文案色自动变，无需额外资源。
 * （小程序端因 image 组件不支持 base64 SVG，改用 PNG 遮罩，见 miniprogram/scripts）
 *
 * 用法：<Icon name="star" size={16} /> 或 <Icon name="trash" className="text-red-500" />
 */
import { ICON_PATHS, type SharedIconName } from '@dustnote/shared';

export type IconName = SharedIconName;

export function Icon({
  name,
  size = 16,
  className,
  strokeWidth = 1.9,
}: {
  name: IconName;
  /** 逻辑像素（正方形） */
  size?: number;
  /** 颜色/尺寸等样式类（颜色建议用 text-* 让它随 currentColor 走） */
  className?: string;
  strokeWidth?: number;
}) {
  const def = ICON_PATHS[name];
  if (!def) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ display: 'inline-block', verticalAlign: '-0.18em', flexShrink: 0 }}
      fill={def.fill ? 'currentColor' : 'none'}
      stroke={def.fill ? 'none' : 'currentColor'}
      strokeWidth={def.fill ? undefined : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={def.path} />
    </svg>
  );
}
