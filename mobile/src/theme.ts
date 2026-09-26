/**
 * 移动端主题：7 主题 × 3 模式（light / dark / auto），与 Web 端同源
 *
 * v2.6 起本文件**不再持有任何颜色字面量**：种子与派生规则都在
 * `@dustnote/shared/theme-engine` + `theme-seeds`，这里只做两件事：
 * ① 把 CSS 三元组转成 RN 能吃的 hex；② 补 RN 平台特有的装饰性差异。
 *
 * 改造前这里是 98 个手写 hex（与 web 各抄一份），已经漂了：
 * liquid-glass 的浅色 bg 在 web 是 #E4EBF8、在安卓是 #EAEFF8；
 * 深色 accent 在 web 是 #7DD3FC、在安卓是 #3B82F6（白字压上去只有 1.75:1）。
 * 这就是审计项 `ARCH-R01` 的成因。见 docs/ui-optimization.md U-2 / §5。
 *
 * 向后兼容：
 * - 保留静态 `theme` / `accent` / `lightColors` / `darkColors` 导出（固定 mint-dawn）
 * - `useColors()` 仍返回 mint50–mint900（映射到当前主题的 accentSoft / accent），
 *   所以旧调用点无需改动即可跟随主题
 */

import { create } from 'zustand';
import { useColorScheme } from 'react-native';
import { useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { THEME_SEEDS, resolvePalette, type ThemeDef } from '@dustnote/shared';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ThemeId =
  | 'mint-dawn'
  | 'mist-blue'
  | 'dusk-forest'
  | 'caramel-warm'
  | 'sakura-pink'
  | 'minimal-white'
  | 'liquid-glass';

/** 主题元数据（与 Web 端 THEMES 一致；id 必须存在于 shared 种子表） */
export const THEMES: { id: ThemeId; name: string }[] = [
  { id: 'mint-dawn', name: '尘心晨光' },
  { id: 'mist-blue', name: '雾霭蓝调' },
  { id: 'dusk-forest', name: '暮色森林' },
  { id: 'caramel-warm', name: '焦糖暖光' },
  { id: 'sakura-pink', name: '樱粉物语' },
  { id: 'minimal-white', name: '极简白' },
  { id: 'liquid-glass', name: '液态玻璃' },
];

/** RN 侧消费的形状：7 个基础色 + 引擎保证 AA 的三档强调/状态色 */
export interface ThemePalette {
  bg: string;
  card: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
  accentSoft: string;
  /** 主按钮底：已保证白字 ≥ 4.5:1 */
  accentStrong: string;
  /** 强调色当文字用：已保证在各层底色上 ≥ 4.5:1 */
  accentText: string;
}

/**
 * RN 无 `backdrop-filter`，液态玻璃只能用半透明叠色做通透近似。
 * 这是**平台渲染限制**、不是配色决定，所以留在这里并显式标注；
 * 色相本身仍来自引擎（见下），只有 alpha 是 RN 专属。
 */
const RN_GLASS_ALPHA: Partial<
  Record<ThemeId, { light?: Partial<ThemePalette>; dark?: Partial<ThemePalette> }>
> = {
  'liquid-glass': {
    light: { card: 'a6', border: 'aa' },
    dark: { card: 'b3', border: '66' },
  },
};

/** 导出供测试与原生组件直接取色（同一份派生结果） */
export function paletteFor(
  id: ThemeId,
  mode: 'light' | 'dark',
  material: Material = 'glass'
): ThemePalette {
  const def = THEME_SEEDS[id] as ThemeDef | undefined;
  if (!def) throw new Error(`theme: 种子表缺少 '${id}'`);
  const p = resolvePalette(def, mode);
  const out: ThemePalette = {
    bg: p.bg,
    card: p.card,
    fg: p.fg,
    muted: p.muted,
    border: p.border,
    accent: p.accent,
    accentSoft: p.accentSoft,
    accentStrong: p.accentStrong,
    accentText: p.accentText,
  };
  // 叠 RN 专属 alpha：把引擎给的 #RRGGBB 变成 #RRGGBBAA
  // 实色档：不叠 RN alpha，card/border 回到引擎给的不透明值
  const alpha = material === 'glass' ? RN_GLASS_ALPHA[id]?.[mode] : undefined;
  if (alpha) {
    for (const key of ['card', 'border'] as const) {
      const suffix = alpha[key];
      if (suffix) out[key] = `${out[key]}${suffix}`;
    }
  }
  return out;
}

/** 由引擎派生的调色板（取代此前手抄的 98 个 hex） */
const THEME_PALETTES: Record<ThemeId, { light: ThemePalette; dark: ThemePalette }> = THEMES.reduce(
  (acc, t) => {
    acc[t.id] = { light: paletteFor(t.id, 'light'), dark: paletteFor(t.id, 'dark') };
    return acc;
  },
  {} as Record<ThemeId, { light: ThemePalette; dark: ThemePalette }>
);

/** 液态玻璃极光渐变（供 GlassScreen 消费；基色跟随引擎的 bg） */
export const LIQUID_GLASS_GRADIENT = {
  light: [
    THEME_PALETTES['liquid-glass'].light.bg,
    THEME_PALETTES['liquid-glass'].light.accentSoft,
    THEME_PALETTES['liquid-glass'].light.bg,
  ],
  dark: [
    THEME_PALETTES['liquid-glass'].dark.bg,
    THEME_PALETTES['liquid-glass'].dark.accentSoft,
    THEME_PALETTES['liquid-glass'].dark.bg,
  ],
} as const;

/** 状态色：同样由引擎按主题派生（旧的 #F5A65B / #EF4444 在白底只有 2.2:1） */
function stateColors(id: ThemeId, mode: 'light' | 'dark') {
  const p = resolvePalette(THEME_SEEDS[id] as ThemeDef, mode);
  return { warn: p.warning, danger: p.danger, success: p.success };
}

// 合并后的颜色集合类型
export type ThemeColors = ThemePalette & {
  accent: string;
  accentSoft: string;
  // mint 渐变（向后兼容：映射到当前主题的 accent / accentSoft）
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
// 固定为 mint-dawn 亮色，不会随主题切换变化；mint50–900 走引擎派生的三档强调色。
const MINT = THEME_PALETTES['mint-dawn'].light;
export const accent = {
  mint50: MINT.accentSoft,
  mint100: MINT.accentSoft,
  mint200: MINT.accentSoft,
  mint300: MINT.accentText,
  mint400: MINT.accentText,
  mint500: MINT.accent,
  mint600: MINT.accentStrong,
  mint700: MINT.accentStrong,
  mint800: MINT.accentStrong,
  mint900: MINT.accentStrong,
  ...stateColors('mint-dawn', 'light'),
};

// 亮色调色板（mint-dawn，向后兼容）
export const lightColors = {
  bg: MINT.bg,
  card: MINT.card,
  fg: MINT.fg,
  muted: MINT.muted,
  border: MINT.border,
};

// 暗色调色板（mint-dawn，向后兼容）
const MINT_DARK = THEME_PALETTES['mint-dawn'].dark;
export const darkColors = {
  bg: MINT_DARK.bg,
  card: MINT_DARK.card,
  fg: MINT_DARK.fg,
  muted: MINT_DARK.muted,
  border: MINT_DARK.border,
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

/**
 * 材质档：玻璃（半透明叠色 + 极光底）或实色。
 * 与 web 的 html[data-effect] 同一语义 —— 三端都得能关，
 * 因为通透近似吃的是合成开销，低配机上该给用户一个退路。
 */
export type Material = 'glass' | 'flat';

const MODE_KEY = 'dustnote_theme_mode';
const MATERIAL_KEY = 'dustnote_material';
const THEME_ID_KEY = 'dustnote_theme_id';
const THEME_IDS = THEMES.map((t) => t.id) as string[];

interface ThemeStoreState {
  mode: ThemeMode;
  themeId: ThemeId;
  material: Material;
  setMode: (m: ThemeMode) => void;
  setThemeId: (id: ThemeId) => void;
  setMaterial: (m: Material) => void;
}

export const useThemeStore = create<ThemeStoreState>((set) => ({
  mode: 'auto',
  themeId: 'liquid-glass',
  material: 'glass',
  setMode: (mode) => {
    AsyncStorage.setItem(MODE_KEY, mode).catch(() => undefined);
    set({ mode });
  },
  setThemeId: (themeId) => {
    AsyncStorage.setItem(THEME_ID_KEY, themeId).catch(() => undefined);
    set({ themeId });
  },
  setMaterial: (material) => {
    AsyncStorage.setItem(MATERIAL_KEY, material).catch(() => undefined);
    set({ material });
  },
}));

// 初始化：从 AsyncStorage 读取已保存的 mode + themeId
Promise.all([
  AsyncStorage.getItem(MODE_KEY),
  AsyncStorage.getItem(THEME_ID_KEY),
  AsyncStorage.getItem(MATERIAL_KEY),
]).then(([v, tid, mat]) => {
  if (mat === 'flat' || mat === 'glass') useThemeStore.setState({ material: mat });
  if (v === 'light' || v === 'dark' || v === 'auto') {
    useThemeStore.setState({ mode: v });
  }
  if (tid && THEME_IDS.includes(tid)) {
    useThemeStore.setState({ themeId: tid as ThemeId });
  }
});

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
  const material = useThemeStore((s) => s.material);
  const systemScheme = useColorScheme();
  const isDark = mode === 'dark' || (mode === 'auto' && systemScheme === 'dark');
  return useMemo(() => {
    const m = isDark ? 'dark' : 'light';
    const palette = paletteFor(themeId, m, material);
    const state = stateColors(themeId, m);
    // mint 渐变映射：浅色档→accentSoft，文字档→accentText，底色档→accentStrong。
    // 这样所有使用 colors.mint600 / colors.mint50 的旧代码自动跟随主题，
    // 且"当文字用"与"当底色用"落到不同的 AA 档上（改造前两者共用一个 accent）。
    return {
      ...palette,
      mint50: palette.accentSoft,
      mint100: palette.accentSoft,
      mint200: palette.accentSoft,
      mint300: palette.accentText,
      mint400: palette.accentText,
      mint500: palette.accent,
      mint600: palette.accentStrong,
      mint700: palette.accentStrong,
      mint800: palette.accentStrong,
      mint900: palette.accentStrong,
      ...state,
    };
  }, [isDark, themeId, material]);
}

/** 当前材质档（GlassScreen 与设置页共用一个判断口径） */
export function useMaterial(): Material {
  return useThemeStore((s) => s.material);
}
