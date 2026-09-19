/**
 * withGlass —— 给任意屏幕套上液态玻璃背景（渐变景）的高阶组件
 *
 * 用法（App.tsx 注册处）：
 *   <Stack.Screen name="Settings" component={withGlass(SettingsScreen)} />
 *
 * 前提：被包裹屏幕的"最外层容器"背景应为 'transparent'（否则实色会盖住渐变）。
 * 屏幕内部若已用 GlassSurface / 半透明 c.card，则自然呈现磨砂玻璃层次。
 *
 * 说明：与手动 <GlassScreen>…</GlassScreen> 等价，集中到注册处统一施加，
 * 避免逐屏改 JSX 结构。已自行用 GlassScreen 包裹的屏幕（Unlock/StandaloneUnlock/
 * ModeSelect）不要重复套，以免双层渐变。
 */
import React from 'react';
import { GlassScreen } from './GlassScreen';

export function withGlass<P extends object>(
  Screen: React.ComponentType<P>
): React.ComponentType<P> {
  const Wrapped: React.FC<P> = (props) => (
    <GlassScreen>
      <Screen {...props} />
    </GlassScreen>
  );
  Wrapped.displayName = `withGlass(${Screen.displayName || Screen.name || 'Screen'})`;
  return Wrapped;
}
