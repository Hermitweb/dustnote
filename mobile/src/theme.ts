/**
 * 移动端主题：与 Web 端保持一致（尘心绿主色 + light/dark/auto 模式）
 *
 * 通过 zustand 持久化 mode 偏好到 AsyncStorage；useColors() 根据 mode + 系统偏好
 * 返回当前应使用的颜色集合。
 */

import { create } from 'zustand';
import { useColorScheme } from 'react-native';
import { useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'light' | 'dark' | 'auto';

// 主色（亮暗模式通用）
export const accent = {
  mint50: '#F0FAF5',
  mint100: '#DCEDC8',
  mint200: '#C5E6BB',
  mint300: '#A8E6CF',
  mint400: '#82D3B0',
  mint500: '#5FBC93',
  mint600: '#4FB783',
  mint700: '#3D9068',
  mint800: '#2F6B4F',
  mint900: '#1F4636',

  // 强调
  warn: '#F5A65B',
  danger: '#EF4444',
  success: '#10B981',
};

// 亮色调色板
export const lightColors = {
  bg: '#FFFFFF',
  card: '#F8FAFC',
  fg: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
};

// 暗色调色板
export const darkColors = {
  bg: '#0B1220',
  card: '#111827',
  fg: '#F1F5F9',
  muted: '#94A3B8',
  border: '#1F2937',
};

// 合并后的颜色集合类型
export type ThemeColors = typeof lightColors & typeof accent;

// ========== 旧静态导出（供未迁移的屏幕使用，例如 SetupScreen） ==========
// 注意：仅亮色，不会随主题切换变化
export const theme = {
  ...accent,
  bgLight: lightColors.bg,
  cardLight: lightColors.card,
  fgLight: lightColors.fg,
  mutedLight: lightColors.muted,
  borderLight: lightColors.border,
  bgDark: darkColors.bg,
  cardDark: darkColors.card,
  fgDark: darkColors.fg,
  mutedDark: darkColors.muted,
  borderDark: darkColors.border,
};

// ========== 主题模式 store ==========

const MODE_KEY = 'mn_theme_mode';

interface ThemeStoreState {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
}

export const useThemeStore = create<ThemeStoreState>((set) => ({
  mode: 'auto',
  setMode: (mode) => {
    AsyncStorage.setItem(MODE_KEY, mode).catch(() => undefined);
    set({ mode });
  },
}));

// 初始化：从 AsyncStorage 读取已保存的 mode
AsyncStorage.getItem(MODE_KEY).then((v) => {
  if (v === 'light' || v === 'dark' || v === 'auto') {
    useThemeStore.setState({ mode: v });
  }
});

// ========== Hooks ==========

/** 当前是否为暗色（综合 mode 与系统偏好） */
export function useIsDark(): boolean {
  const mode = useThemeStore((s) => s.mode);
  const systemScheme = useColorScheme();
  return mode === 'dark' || (mode === 'auto' && systemScheme === 'dark');
}

/** 返回当前应使用的颜色集合（surface + accent） */
export function useColors(): ThemeColors {
  const mode = useThemeStore((s) => s.mode);
  const systemScheme = useColorScheme();
  const isDark = mode === 'dark' || (mode === 'auto' && systemScheme === 'dark');
  return useMemo(() => {
    const surface = isDark ? darkColors : lightColors;
    return { ...surface, ...accent };
  }, [isDark]);
}
