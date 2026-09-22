/**
 * 液态玻璃表面（移动端真·高斯模糊原语）
 *
 * - 若原生库 @react-native-community/blur 已安装并链接 → 用 BlurView 做真模糊；
 * - 否则（未链接 / 未安装 / 运行环境不支持）→ 优雅降级为半透明 View（沿用主题
 *   card 色），保证不崩溃、不白屏。
 *
 * 采用方式：把需要玻璃质感的容器
 *   <View style={{ backgroundColor: colors.card }}>…</View>
 * 换成
 *   <GlassSurface intensity={20}>…</GlassSurface>
 *
 * 注意：Android 需在 gradle 构建时 autolink；iOS 需 pod install。本组件对缺失
 * 场景做了运行时兜底，因此未链接时退化为纯色半透明，不影响功能。
 */
import React from 'react';
import { Platform, View, type ViewProps } from 'react-native';
import { useColors, useIsDark } from '../theme';

type GlassSurfaceProps = ViewProps & {
  /** 模糊强度（iOS blurAmount / Android blurAmount），默认 20 */
  intensity?: number;
};

// 运行时软依赖：未安装 / 未链接时 require 抛错被吞，BlurView 置空
let BlurView: React.ComponentType<Record<string, unknown>> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@react-native-community/blur') as {
    BlurView?: React.ComponentType<Record<string, unknown>>;
  };
  BlurView = mod.BlurView ?? null;
} catch {
  BlurView = null;
}

// 安卓不使用原生 BlurView：该库在各 GPU / 模拟器(swiftshader)上普遍渲染成
// 黑屏 / 花屏 / 直接崩溃（lib 内部 setupWith(decorView) 快照整窗内容含自身，
// 反馈回路产物不可控）——v2.5.41 安卓解锁屏「崩坏」实锤。安卓统一走下方
// 半透明降级路径（视觉与玻璃基调一致且稳定）；iOS 的 BlurView 成熟，保留真模糊。
// 注意 narrowing 必须内联判断（Platform.OS === 'ios' && BlurView），
// 经模块级布尔常量中转会让 TS 丢失 try 块内赋值的类型收窄。

export function GlassSurface({ intensity = 20, style, children, ...rest }: GlassSurfaceProps) {
  const colors = useColors();
  const isDark = useIsDark();

  if (Platform.OS === 'ios' && BlurView) {
    return (
      <BlurView
        blurType={isDark ? 'dark' : 'light'}
        blurAmount={intensity}
        overlayColor={colors.card}
        reducedBlurIOS={30}
        style={style}
        {...rest}
      >
        {children}
      </BlurView>
    );
  }

  // 降级：半透明主题色平面（无模糊，但视觉与玻璃基调一致）
  return (
    <View style={[{ backgroundColor: colors.card }, style]} {...rest}>
      {children}
    </View>
  );
}
