/**
 * 小程序状态版面（空 / 加载 / 错误三态的统一起版）
 *
 * 规格来自 web/src/components/StatePlate.tsx，两端同一套节奏：
 *   图版 →12→ 标题 →6→ 提示 →12→ 详情 →12→ 动作
 * 两档：plate=页面级空态（图版 88rpx），card=阻断式错误屏（图版 112rpx）。
 *
 * 为什么要单独一个组件而不是继续堆 .empty-state：改造前三端的"这里没有东西 /
 * 这里出错了"各自排版，同一个动作在小程序里比 web 大一圈、错误屏根本没有图版，
 * 用户每换一端都要重新读一遍版面。
 */
import { Text, View } from '@tarojs/components';
import type { FC, ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from '@dustnote/shared';

export type StateTone = 'info' | 'guide' | 'danger';
export type StatePlateSize = 'plate' | 'card';

/** 与 web 的 TILE 同口径：plate=20 图标，card=28 图标 */
const ICON_SIZE: Record<StatePlateSize, number> = { plate: 20, card: 28 };

export interface StatePlateProps {
  icon: IconName;
  title: string;
  tone?: StateTone;
  size?: StatePlateSize;
  hint?: ReactNode;
  /** 错误屏的原始信息（错误码 / 服务端响应）；正常态不要传 */
  detail?: ReactNode;
  /** 动作区：调用方给 <Text className="state-plate-btn ..."> 组成的节点 */
  actions?: ReactNode;
  /** 加载占位：给了它就不渲染图标，外框尺寸保持不变 */
  busy?: boolean;
}

export const StatePlate: FC<StatePlateProps> = ({
  icon,
  title,
  tone = 'info',
  size = 'plate',
  hint,
  detail,
  actions,
  busy = false,
}) => (
  <View className={`state-plate state-plate--${size}`}>
    {busy ? (
      <View className="state-plate-tile">
        <View className="state-plate-spinner" />
      </View>
    ) : (
      <View className={`state-plate-tile state-plate-tile--${tone}`}>
        <Icon name={icon} size={ICON_SIZE[size]} />
      </View>
    )}
    <Text className="state-plate-title">{title}</Text>
    {hint ? (
      <View className="state-plate-hint">
        {typeof hint === 'string' ? <Text>{hint}</Text> : hint}
      </View>
    ) : null}
    {detail ? <View className="state-plate-detail">{detail}</View> : null}
    {actions ? <View className="state-plate-actions">{actions}</View> : null}
  </View>
);

export default StatePlate;
