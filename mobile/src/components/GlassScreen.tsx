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
import LinearGradient from 'react-native-linear-gradient';
import { useIsDark } from '../theme';

type GlassScreenProps = ViewProps & { children: React.ReactNode };

const LIGHT = ['#EAEFF8', '#E9F1FB', '#F3ECFB'];
const DARK = ['#0B1120', '#12233F', '#0B1120'];

export function GlassScreen({ children, style, ...rest }: GlassScreenProps) {
  const isDark = useIsDark();
  return (
    <View style={[styles.root, style]} {...rest}>
      <LinearGradient colors={isDark ? DARK : LIGHT} style={StyleSheet.absoluteFill} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
});
