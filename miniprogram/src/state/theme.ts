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

/**
 * 材质档：glass = 半透明叠色 + 极光层；flat = 全部回实色。
 * 与 web 的 html[data-effect] 同一语义（§2.2）—— weapp 没有 backdrop-filter，
 * 通透靠叠色近似，代价是合成开销，低配机必须能关。
 */
export type Material = 'glass' | 'flat';

const STORAGE_KEY = 'dustnote_theme';
const MATERIAL_KEY = 'dustnote_material';

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
    // getAppBaseInfo 是 getSystemInfoSync 弃用后的替代（theme 字段等价）；
    // 旧基础库无此 API 时回退 getSystemInfoSync
    const getBase = Taro.getAppBaseInfo as unknown as (() => { theme?: string }) | undefined;
    if (typeof getBase === 'function') {
      return getBase().theme === 'dark' ? 'dark' : 'light';
    }
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

export function currentEffectiveTheme(
  theme: Theme,
  systemDarkOverride?: boolean
): 'light' | 'dark' {
  if (theme === 'auto' && typeof systemDarkOverride === 'boolean') {
    return systemDarkOverride ? 'dark' : 'light';
  }
  return resolveEffective(theme);
}

export { systemTheme };

/**
 * 页面根 View 的样式类（纯函数，便于单测）
 *
 * 三件事叠在一起决定结果，每一件事单独看都"好像对"，合起来出过手动暗色+系统浅色
 * 透出白底的问题：
 *   - theme：light / dark / auto
 *   - systemDark：auto 与"手动浅色但系统是深色"时的反制依据
 *   - material：实色档必须追加 material-flat，否则设置里的开关只在部分主题下生效
 * weapp 还要 page-solid（极光层在 weapp 不渲染，需铺实底），H5 不铺（会盖掉极光）。
 */
export function rootClassOf(opts: {
  theme: Theme;
  systemDark: boolean;
  material: Material;
  taroEnv: string;
}): string {
  const parts: string[] = [];
  if (opts.theme === 'dark') parts.push('theme-dark');
  else if (opts.theme === 'light' && opts.systemDark) parts.push('theme-light');
  if (opts.taroEnv === 'weapp') parts.push('page-solid');
  if (opts.material === 'flat') parts.push('material-flat');
  return parts.join(' ');
}

interface ThemeStoreState {
  theme: Theme;
  material: Material;
  systemDark: boolean;
  refreshSystemTheme: () => void;
  setTheme: (t: Theme) => void;
  setMaterial: (m: Material) => void;
}

function readInitialMaterial(): Material {
  try {
    const v = Taro.getStorageSync(MATERIAL_KEY) as Material | '';
    if (v === 'glass' || v === 'flat') return v;
  } catch {
    /* ignore */
  }
  return 'glass';
}

export const useThemeStore = create<ThemeStoreState>((set) => ({
  theme: readInitialTheme(),
  material: readInitialMaterial(),
  systemDark: false,
  refreshSystemTheme: () => set({ systemDark: systemTheme() === 'dark' }),
  setTheme: (t) => {
    applyTheme(t);
    set({ theme: t });
  },
  setMaterial: (m) => {
    try {
      Taro.setStorageSync(MATERIAL_KEY, m);
    } catch {
      /* ignore */
    }
    set({ material: m });
  },
}));
