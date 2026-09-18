/**
 * 统一线条图标（替代 emoji）
 *
 * 为什么不用 emoji：emoji 跨机型渲染不一致（iOS/安卓/开发者工具三套脸）、
 * 彩色破坏单色层级、且无法随主题变色——是「廉价感」的主要来源。
 *
 * 实现：PNG 遮罩 + currentColor（等价图标字体）。
 * 形状来自 miniprogram/scripts/gen-icons.mjs 生成的 src/styles/icons.wxss
 * （`-webkit-mask-image` 内联 base64）。颜色由 CSS `color` 决定——
 * 默认继承所在文本色（可随主题自动变），传 color prop 可覆写。
 *
 * 为什么不用 <image src="data:image/svg+xml,...">：小程序 image 组件对
 * SVG 只稳定支持网络地址，base64 SVG 在部分平台不渲染；PNG 遮罩则任何
 * 渲染模式下都可靠。
 *
 * 用法：<Icon name="star" size={18} color="#E8B86B" />
 */
import { Text } from '@tarojs/components';

/** 可用图标名（与 gen-icons.mjs 的 PATHS 键一致） */
export type IconName =
  | 'plus'
  | 'check'
  | 'close'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'star'
  | 'star-filled'
  | 'bookmark'
  | 'bookmark-filled'
  | 'folder'
  | 'trash'
  | 'share'
  | 'clock'
  | 'file-text'
  | 'more'
  | 'search'
  | 'settings'
  | 'edit'
  | 'mic'
  | 'tag'
  | 'copy'
  | 'lock'
  | 'alert'
  | 'eye'
  | 'layers'
  | 'link'
  | 'refresh'
  | 'download'
  | 'zoom-in'
  | 'list';

export function Icon(props: {
  name: IconName;
  /** 逻辑像素（内部 ×2 转 rpx）；默认 18 */
  size?: number;
  /** 不传则继承所在文本颜色（随主题） */
  color?: string;
}) {
  const size = props.size ?? 18;
  return (
    <Text
      className={`icon icon-${props.name}`}
      style={{
        width: `${size * 2}rpx`,
        height: `${size * 2}rpx`,
        ...(props.color ? { color: props.color } : {}),
      }}
    />
  );
}
