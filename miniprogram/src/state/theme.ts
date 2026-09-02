/**
 * 主题状态：light / dark / auto
 *
 * - 持久化到 Taro storage（key: dustnote_theme）
 * - H5：document.documentElement.setAttribute('data-mode', ...)
 * - weapp：通过 <PageMeta pageStyle> 注入页面根 CSS 变量（components/ThemeVars.tsx），
 *   auto 模式读取系统主题（app.json darkmode: true 后 getSystemInfoSync().theme 可用）
 */
import { create } from 'zustand';
import Taro from '@tarojs/taro';

export type Theme = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'dustnote_theme';

function readInitialTheme(): Theme {
  try {
    const v = Taro.getStorageSync(STORAGE_KEY) as Theme | '';
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch {
    /* ignore */
  }
  return 'light';
}

function systemTheme(): 'light' | 'dark' {
  try {
    const info = Taro.getSystemInfoSync();
    return (info as { theme?: string }).theme === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function resolveEffective(theme: Theme): 'light' | 'dark' {
  if (theme === 'auto') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return systemTheme();
  }
  return theme;
}

export function applyTheme(theme: Theme): void {
  try {
    Taro.setStorageSync(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  // 仅 H5 模式可操作 DOM；weapp 由 ThemeVars 组件注入 pageStyle
  if (process.env.TARO_ENV === 'h5' && typeof document !== 'undefined') {
    const effective = resolveEffective(theme);
    document.documentElement.setAttribute('data-mode', effective);
  }
}

export function currentEffectiveTheme(theme: Theme): 'light' | 'dark' {
  return resolveEffective(theme);
}

export { systemTheme };

interface ThemeStoreState {
  theme: Theme;
  systemDark: boolean;
  refreshSystemTheme: () => void;
  setTheme: (t: Theme) => void;
}

export const useThemeStore = create<ThemeStoreState>((set) => ({
  theme: readInitialTheme(),
  systemDark: false,
  refreshSystemTheme: () => set({ systemDark: systemTheme() === 'dark' }),
  setTheme: (t) => {
    applyTheme(t);
    set({ theme: t });
  },
}));
