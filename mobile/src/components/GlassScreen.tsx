/**
 * 玻璃屏容器（移动端）
 *
 * RN 无 CSS 渐变 / backdrop-filter，"玻璃"必须有可透的底层内容——本组件铺一层
 * 柔和极光渐变作背景，上层再放 GlassSurface（BlurView 真模糊 / 半透明降级）卡片，
 * 即得通透的液态玻璃观感。
 *
 * 用法：
 *   <GlassScreen>
 *     <GlassSurface style={cardStyle}>…内容…</GlassSurface>
 *   </GlassScreen>
 *
 * 注意：LinearGradient 为原生依赖，Android 需 gradle autolink、iOS 需 pod install。
 */
import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { useIsDark, useColors, useMaterial, LIQUID_GLASS_GRADIENT } from '../theme';

type GlassScreenProps = ViewProps & { children: React.ReactNode };

// 运行时软依赖：未安装/未链接(autolink 静默失败)时降级为纯色，避免整应用启动崩溃
let LinearGradient: React.ComponentType<Record<string, unknown>> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('react-native-linear-gradient') as {
    default?: React.ComponentType<Record<string, unknown>>;
  };
  LinearGradient = mod.default ?? null;
} catch {
  LinearGradient = null;
}

export function GlassScreen({ children, style, ...rest }: GlassScreenProps) {
  const isDark = useIsDark();
  const material = useMaterial();
  const { bg } = useColors();
  const colors = isDark ? LIQUID_GLASS_GRADIENT.dark : LIQUID_GLASS_GRADIENT.light;
  return (
    <View style={[styles.root, style]} {...rest}>
      {material === 'flat' ? (
        /* 实色档：一层不透明主题底色，极光与半透明叠色全部关掉 */
        <View style={[StyleSheet.absoluteFill, { backgroundColor: bg }]} />
      ) : LinearGradient ? (
        <LinearGradient colors={colors} style={StyleSheet.absoluteFill} />
      ) : (
        // 降级：纯色底（取渐变首色），保证不崩、仍有背景层次
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors[0] }]} />
      )}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
});
