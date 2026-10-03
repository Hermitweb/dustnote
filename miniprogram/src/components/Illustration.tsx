/**
 * 小程序插画（两层 mask 叠加，见 styles/mp-illustrations.scss 的生成注释）
 *
 * 尺寸吃 shared 的 ILL_SIZES：设计 px ×2 转 rpx，与 web / RN 同一口径。
 * 颜色不在这里写 —— ink 层是 currentColor（继承文字色），accent 层是 var(--primary)，
 * 两条都定义在生成的 scss 里。
 */
import { View } from '@tarojs/components';
import type { FC } from 'react';
import { ILL_SIZES, ILLUSTRATIONS, type IllName, type IllSize } from '@dustnote/shared';

export interface IllustrationProps {
  name: IllName;
  size?: IllSize;
  className?: string;
}

export const Illustration: FC<IllustrationProps> = ({ name, size = 'plate', className = '' }) => {
  const d = ILL_SIZES[size];
  /* 没有 accent 节点的插画（plain）只发一层，省一个空 mask */
  const hasAccent = (ILLUSTRATIONS[name] as readonly { c?: string }[]).some(
    (n) => n.c === 'accent'
  );
  return (
    <View
      className={`mp-illust mp-illust--${name}${className ? ' ' + className : ''}`}
      style={{ width: `${d.w * 2}rpx`, height: `${d.h * 2}rpx` }}
      aria-hidden="true"
    >
      <View className="mp-illust-layer mp-illust-layer--ink" />
      {hasAccent ? <View className="mp-illust-layer mp-illust-layer--accent" /> : null}
    </View>
  );
};

export default Illustration;
