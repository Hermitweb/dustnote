/**
 * 移动端主题：6 主题 × 3 模式（light / dark / auto），与 Web 端保持一致
 *
 * 主题（ThemeId）：mint-dawn / mist-blue / dusk-forest / caramel-warm / sakura-pink / minimal-white
 * 模式（ThemeMode）：light / dark / auto（auto 跟随系统）
 *
 * 通过 zustand 持久化 themeId + mode 偏好到 AsyncStorage；useColors() 根据当前
 * 主题 + 模式 + 系统偏好返回应使用的颜色集合。
 *
 * 向后兼容：
 * - 保留静态 `theme` 导出（mint-dawn 默认色）供未迁移屏幕（如 SetupScreen）使用
 * - useColors() 返回的 mint50–mint900 渐变映射到当前主题的 accent / accentSoft，
 *   这样所有使用 colors.mint600 / colors.mint50 的旧代码会自动跟随主题切换
 */

import { create } from 'zustand';
import { useColorScheme } from 'react-native';
import { useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ThemeId =
  | 'mint-dawn'
  | 'mist-blue'
  | 'dusk-forest'
  | 'caramel-warm'
  | 'sakura-pink'
  | 'minimal-white';

/** 6 主题元数据（与 Web 端 THEMES 一致） */
export const THEMES: { id: ThemeId; name: string; emoji: string }[] = [
  { id: 'mint-dawn', name: '尘心晨光', emoji: '🌿' },
  { id: 'mist-blue', name: '雾霭蓝调', emoji: '🌫️' },
  { id: 'dusk-forest', name: '暮色森林', emoji: '🌲' },
  { id: 'caramel-warm', name: '焦糖暖光', emoji: '☕' },
  { id: 'sakura-pink', name: '樱粉物语', emoji: '🌸' },
  { id: 'minimal-white', name: '极简白', emoji: '◽' },
];

// ========== 主题调色板（与 Web 端 THEME_TOKENS 一一对应，RGB→hex） ==========

interface ThemePalette {
  bg: string;
  card: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
  accentSoft: string;
}

const THEME_PALETTES: Record<ThemeId, { light: ThemePalette; dark: ThemePalette }> = {
  'mint-dawn': {
    light: {
      bg: '#F7FAF7',
      card: '#FFFFFF',
      fg: '#1E293B',
      muted: '#64748B',
      border: '#E2E8F0',
      accent: '#16A34A',
      accentSoft: '#DCFCE7',
    },
    dark: {
      bg: '#0F172A',
      card: '#1E293B',
      fg: '#E2E8F0',
      muted: '#94A3B8',
      border: '#334155',
      accent: '#4ADE80',
      accentSoft: '#14532D',
    },
  },
  'mist-blue': {
    light: {
      bg: '#F1F5F9',
      card: '#FFFFFF',
      fg: '#0F172A',
      muted: '#475569',
      border: '#CBD5E1',
      accent: '#3B82F6',
      accentSoft: '#DBEAFE',
    },
    dark: {
      bg: '#0F172A',
      card: '#1E293B',
      fg: '#E2E8F0',
      muted: '#94A3B8',
      border: '#334155',
      accent: '#60A5FA',
      accentSoft: '#1E3A8A',
    },
  },
  'dusk-forest': {
    light: {
      bg: '#F5F6F0',
      card: '#FFFFFF',
      fg: '#1D2924',
      muted: '#576056',
      border: '#D7DED1',
      accent: '#657B4E',
      accentSoft: '#E6EEDA',
    },
    dark: {
      bg: '#141E18',
      card: '#202D24',
      fg: '#DCE6D7',
      muted: '#94A390',
      border: '#323C32',
      accent: '#94B871',
      accentSoft: '#374E29',
    },
  },
  'caramel-warm': {
    light: {
      bg: '#FCF8F3',
      card: '#FFFAF0',
      fg: '#3F2719',
      muted: '#78604E',
      border: '#E9DCC6',
      accent: '#B45309',
      accentSoft: '#FEF3C7',
    },
    dark: {
      bg: '#1C1610',
      card: '#2D231A',
      fg: '#F0E6D7',
      muted: '#B4A082',
      border: '#3C3226',
      accent: '#D97706',
      accentSoft: '#5A320C',
    },
  },
  'sakura-pink': {
    light: {
      bg: '#FDF4F7',
      card: '#FFFAFC',
      fg: '#4C2132',
      muted: '#9C6E7C',
      border: '#F5D7E2',
      accent: '#DB507C',
      accentSoft: '#FCE8F0',
    },
    dark: {
      bg: '#1C1418',
      card: '#2A1E24',
      fg: '#F0D7DE',
      muted: '#B48C98',
      border: '#3C2832',
      accent: '#F472B6',
      accentSoft: '#701A3C',
    },
  },
  'minimal-white': {
    light: {
      bg: '#FFFFFF',
      card: '#FAFAFA',
      fg: '#171717',
      muted: '#737373',
      border: '#E5E5E5',
      accent: '#171717',
      accentSoft: '#F5F5F5',
    },
    dark: {
      bg: '#0A0A0A',
      card: '#171717',
      fg: '#F0F0F0',
      muted: '#8C8C8C',
      border: '#323232',
      accent: '#F0F0F0',
      accentSoft: '#3C3C3C',
    },
  },
};

// 通用强调色（与主题无关，所有主题共用）
const COMMON_ACCENT = {
  warn: '#F5A65B',
  danger: '#EF4444',
  success: '#10B981',
};

// 合并后的颜色集合类型
export type ThemeColors = ThemePalette & {
  accent: string;
  accentSoft: string;
  // mint 渐变（向后兼容：映射到当前主题 accent / accentSoft）
  mint50: string;
  mint100: string;
  mint200: string;
  mint300: string;
  mint400: string;
  mint500: string;
  mint600: string;
  mint700: string;
  mint800: string;
  mint900: string;
  warn: string;
  danger: string;
  success: string;
};

// ========== 旧静态导出（供未迁移的屏幕使用，例如 SetupScreen） ==========
// 注意：固定为 mint-dawn 亮/暗色，不会随主题切换变化
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
  warn: COMMON_ACCENT.warn,
  danger: COMMON_ACCENT.danger,
  success: COMMON_ACCENT.success,
};

// 亮色调色板（mint-dawn，向后兼容）
export const lightColors = {
  bg: THEME_PALETTES['mint-dawn'].light.bg,
  card: THEME_PALETTES['mint-dawn'].light.card,
  fg: THEME_PALETTES['mint-dawn'].light.fg,
  muted: THEME_PALETTES['mint-dawn'].light.muted,
  border: THEME_PALETTES['mint-dawn'].light.border,
};

// 暗色调色板（mint-dawn，向后兼容）
export const darkColors = {
  bg: THEME_PALETTES['mint-dawn'].dark.bg,
  card: THEME_PALETTES['mint-dawn'].dark.card,
  fg: THEME_PALETTES['mint-dawn'].dark.fg,
  muted: THEME_PALETTES['mint-dawn'].dark.muted,
  border: THEME_PALETTES['mint-dawn'].dark.border,
};

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

const MODE_KEY = 'dustnote_theme_mode';
const THEME_ID_KEY = 'dustnote_theme_id';

interface ThemeStoreState {
  mode: ThemeMode;
  themeId: ThemeId;
  setMode: (m: ThemeMode) => void;
  setThemeId: (id: ThemeId) => void;
}

export const useThemeStore = create<ThemeStoreState>((set) => ({
  mode: 'auto',
  themeId: 'mint-dawn',
  setMode: (mode) => {
    AsyncStorage.setItem(MODE_KEY, mode).catch(() => undefined);
    set({ mode });
  },
  setThemeId: (themeId) => {
    AsyncStorage.setItem(THEME_ID_KEY, themeId).catch(() => undefined);
    set({ themeId });
  },
}));

// 初始化：从 AsyncStorage 读取已保存的 mode + themeId
Promise.all([AsyncStorage.getItem(MODE_KEY), AsyncStorage.getItem(THEME_ID_KEY)]).then(
  ([v, tid]) => {
    if (v === 'light' || v === 'dark' || v === 'auto') {
      useThemeStore.setState({ mode: v });
    }
    if (
      tid === 'mint-dawn' ||
      tid === 'mist-blue' ||
      tid === 'dusk-forest' ||
      tid === 'caramel-warm' ||
      tid === 'sakura-pink' ||
      tid === 'minimal-white'
    ) {
      useThemeStore.setState({ themeId: tid });
    }
  }
);

// ========== Hooks ==========

/** 当前是否为暗色（综合 mode 与系统偏好） */
export function useIsDark(): boolean {
  const mode = useThemeStore((s) => s.mode);
  const systemScheme = useColorScheme();
  return mode === 'dark' || (mode === 'auto' && systemScheme === 'dark');
}

/** 返回当前应使用的颜色集合（surface + accent + mint 渐变兼容） */
export function useColors(): ThemeColors {
  const mode = useThemeStore((s) => s.mode);
  const themeId = useThemeStore((s) => s.themeId);
  const systemScheme = useColorScheme();
  const isDark = mode === 'dark' || (mode === 'auto' && systemScheme === 'dark');
  return useMemo(() => {
    const palette = THEME_PALETTES[themeId][isDark ? 'dark' : 'light'];
    // mint 渐变映射：浅色档→accentSoft，深色档→accent
    // 这样所有使用 colors.mint600 / colors.mint50 的旧代码自动跟随主题
    return {
      ...palette,
      accent: palette.accent,
      accentSoft: palette.accentSoft,
      mint50: palette.accentSoft,
      mint100: palette.accentSoft,
      mint200: palette.accentSoft,
      mint300: palette.accent,
      mint400: palette.accent,
      mint500: palette.accent,
      mint600: palette.accent,
      mint700: palette.accent,
      mint800: palette.accent,
      mint900: palette.accent,
      warn: COMMON_ACCENT.warn,
      danger: COMMON_ACCENT.danger,
      success: COMMON_ACCENT.success,
    };
  }, [isDark, themeId]);
}
