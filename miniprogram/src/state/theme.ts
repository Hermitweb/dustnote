/**
 * 主题状态：light / dark / auto
 *
 * 简化实现：
 * - 持久化到 Taro storage（key: mn_theme）
 * - 仅 H5 模式下通过 document.documentElement.setAttribute('data-mode', ...) 实际生效
 * - weapp 模式暂不支持（变量无法在运行时切换）
 */
import { create } from 'zustand';
import Taro from '@tarojs/taro';

export type Theme = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'mn_theme';

function readInitialTheme(): Theme {
  try {
    const v = Taro.getStorageSync(STORAGE_KEY) as Theme | '';
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch { /* ignore */ }
  return 'light';
}

function resolveEffective(theme: Theme): 'light' | 'dark' {
  if (theme === 'auto') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }
  return theme;
}

export function applyTheme(theme: Theme): void {
  try { Taro.setStorageSync(STORAGE_KEY, theme); } catch { /* ignore */ }
  // 仅 H5 模式可操作 DOM
  if (process.env.TARO_ENV === 'h5' && typeof document !== 'undefined') {
    const effective = resolveEffective(theme);
    document.documentElement.setAttribute('data-mode', effective);
  }
}

interface ThemeStoreState {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

export const useThemeStore = create<ThemeStoreState>((set) => ({
  theme: readInitialTheme(),
  setTheme: (t) => {
    applyTheme(t);
    set({ theme: t });
  },
}));
