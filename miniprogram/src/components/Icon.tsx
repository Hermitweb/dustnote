/**
 * 小程序图标（图形源 = lucide，名字表 = shared/src/icons.ts）
 *
 * 渲染方式是"遮罩"：图形当 mask、颜色走 background-color，因此 `color` 继承文字色，
 * 语义等价于 web/RN 的 currentColor——图标跟着主题变色，而不是每张图配一个深色版本。
 * 具体 mask 规则由 scripts/gen-mp-icons.mjs 生成到 styles/mp-icons.scss。
 *
 * 尺寸入参用**设计 px**（与 web/RN 的 size 同一口径），内部按 750 设计稿 ×2 转 rpx。
 * 直接收 rpx 会让同一图标在三端要写三个数，那正是 §U-1 当初的成因。
 */
import { Text } from '@tarojs/components';
import type { FC, CSSProperties } from 'react';
import { isIconName, type IconName } from '@dustnote/shared';

export interface IconProps {
  name: IconName;
  /** 设计 px；与 web/RN 同口径 */
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** 装饰性图标（旁边已有文字）保持 true；纯图标按钮请传 false 并给 text */
  decorative?: boolean;
  text?: string;
}

export const Icon: FC<IconProps> = ({
  name,
  size = 20,
  className = '',
  style,
  decorative = true,
  text,
}) => (
  <Text
    className={`mp-icon mp-icon--${name}${className ? ' ' + className : ''}`}
    style={{ width: `${size * 2}rpx`, height: `${size * 2}rpx`, ...style }}
    aria-hidden={decorative ? 'true' : undefined}
    aria-label={decorative ? undefined : text}
  >
    {'\u00A0'}
  </Text>
);

/** 见 web 同名组件的说明：icon 字段是用户数据，可能是历史 emoji，两条路都走得通 */
export const IconOrText: FC<{ value: string; size?: number; className?: string }> = ({
  value,
  size = 18,
  className,
}) =>
  isIconName(value) ? (
    <Icon name={value} size={size} className={className} />
  ) : (
    <Text className={className}>{value}</Text>
  );
