/**
 * RN 状态版面（空 / 加载 / 错误三态的统一起版）
 *
 * 规格来源：web/src/components/StatePlate.tsx。两端同一节奏：
 *   图版 →12→ 标题 →6→ 提示 →12→ 详情 →12→ 动作
 * 两档只差体量（plate 图版 44 / card 图版 56），因此从空态切到错误屏不会重排。
 *
 * 为什么 RN 单独写一份：RN 没有 CSS，尺寸与颜色只能显式给；颜色必须来自
 * useColors()（主题引擎算出来的对比度安全的值），不能像 ErrorBoundary 那样硬写
 * '#16A34A'——那正是深色档下白字只有 1.75:1 的成因。
 */
import { ActivityIndicator, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import type { IconName } from '@dustnote/shared';
import { Icon } from './Icon';
import { useColors } from '../theme';

export type StateTone = 'info' | 'guide' | 'danger';
export type StatePlateSize = 'plate' | 'card';

/** 与 web 的 TILE 同一口径（web 用类名，这里只能用数字） */
const TILE: Record<StatePlateSize, { box: number; icon: number; title: number }> = {
  plate: { box: 44, icon: 20, title: 14 },
  card: { box: 56, icon: 28, title: 18 },
};

export interface StatePlateProps {
  icon: IconName;
  title: string;
  tone?: StateTone;
  size?: StatePlateSize;
  hint?: ReactNode;
  /** 错误屏的原始信息；正常态不要传 */
  detail?: ReactNode;
  actions?: ReactNode;
  /** 加载占位：图版位置换成转圈，外框尺寸不变 */
  busy?: boolean;
}

export function StatePlate({
  icon,
  title,
  tone = 'info',
  size = 'plate',
  hint,
  detail,
  actions,
  busy = false,
}: StatePlateProps) {
  const c = useColors();
  const t = TILE[size];
  const toneColor = tone === 'danger' ? c.danger : tone === 'guide' ? c.accentText : c.muted;
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: size === 'plate' ? 48 : 32,
        paddingHorizontal: 24,
      }}
    >
      <View
        style={{
          width: t.box,
          height: t.box,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.card,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {busy ? (
          <ActivityIndicator size="small" color={c.accent} />
        ) : (
          <Icon name={icon} size={t.icon} color={toneColor} />
        )}
      </View>
      <Text
        style={{
          marginTop: 12,
          fontSize: t.title,
          fontWeight: '500',
          color: c.fg,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      {hint ? (
        <Text
          style={{
            marginTop: 6,
            fontSize: 12,
            lineHeight: 18,
            color: c.muted,
            textAlign: 'center',
          }}
        >
          {hint}
        </Text>
      ) : null}
      {detail ? (
        <View
          style={{
            marginTop: 12,
            alignSelf: 'stretch',
            padding: 10,
            borderRadius: 8,
            /* 详情槽要比所在容器更亮/更暗一档才读得出是一块。
               以前写 c.bg：崩溃屏本身就是 c.bg，整块隐形。 */
            backgroundColor: c.card,
          }}
        >
          {detail}
        </View>
      ) : null}
      {actions ? (
        <View style={{ marginTop: 12, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {actions}
        </View>
      ) : null}
    </View>
  );
}

export default StatePlate;
