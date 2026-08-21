/**
 * 主题系统
 * 6 主题 × 3 模式（light / dark / auto）
 * 详见 theme-system.md
 *
 * 实现：CSS 变量驱动 + data-theme / data-mode 切换
 */

import type { ThemeId, Mode, Preferences } from './store';

export const THEMES: { id: ThemeId; name: string; emoji: string }[] = [
  { id: 'mint-dawn', name: '尘心晨光', emoji: '🌿' },
  { id: 'mist-blue', name: '雾霭蓝调', emoji: '🌫️' },
  { id: 'dusk-forest', name: '暮色森林', emoji: '🌲' },
  { id: 'caramel-warm', name: '焦糖暖光', emoji: '☕' },
  { id: 'sakura-pink', name: '樱粉物语', emoji: '🌸' },
  { id: 'minimal-white', name: '极简白', emoji: '◽' },
];

const THEME_TOKENS: Record<
  ThemeId,
  { light: Record<string, string>; dark: Record<string, string> }
> = {
  'mint-dawn': {
    light: {
      '--mn-bg': '247 250 247',
      '--mn-fg': '30 41 59',
      '--mn-fg-muted': '100 116 139',
      '--mn-border': '226 232 240',
      '--mn-card': '255 255 255',
      '--mn-accent': '22 163 74',
      '--mn-accent-soft': '220 252 231',
    },
    dark: {
      '--mn-bg': '15 23 42',
      '--mn-fg': '226 232 240',
      '--mn-fg-muted': '148 163 184',
      '--mn-border': '51 65 85',
      '--mn-card': '30 41 59',
      '--mn-accent': '74 222 128',
      '--mn-accent-soft': '20 83 45',
    },
  },
  'mist-blue': {
    light: {
      '--mn-bg': '241 245 249',
      '--mn-fg': '15 23 42',
      '--mn-fg-muted': '71 85 105',
      '--mn-border': '203 213 225',
      '--mn-card': '255 255 255',
      '--mn-accent': '59 130 246',
      '--mn-accent-soft': '219 234 254',
    },
    dark: {
      '--mn-bg': '15 23 42',
      '--mn-fg': '226 232 240',
      '--mn-fg-muted': '148 163 184',
      '--mn-border': '51 65 85',
      '--mn-card': '30 41 59',
      '--mn-accent': '96 165 250',
      '--mn-accent-soft': '30 58 138',
    },
  },
  'dusk-forest': {
    light: {
      '--mn-bg': '245 246 240',
      '--mn-fg': '29 41 36',
      '--mn-fg-muted': '87 96 86',
      '--mn-border': '215 222 209',
      '--mn-card': '255 255 255',
      '--mn-accent': '101 123 78',
      '--mn-accent-soft': '230 238 218',
    },
    dark: {
      '--mn-bg': '20 30 24',
      '--mn-fg': '220 230 215',
      '--mn-fg-muted': '148 163 144',
      '--mn-border': '50 60 50',
      '--mn-card': '32 45 36',
      '--mn-accent': '148 184 113',
      '--mn-accent-soft': '55 78 41',
    },
  },
  'caramel-warm': {
    light: {
      '--mn-bg': '252 248 243',
      '--mn-fg': '63 39 25',
      '--mn-fg-muted': '120 96 78',
      '--mn-border': '233 220 198',
      '--mn-card': '255 250 240',
      '--mn-accent': '180 83 9',
      '--mn-accent-soft': '254 243 199',
    },
    dark: {
      '--mn-bg': '28 22 16',
      '--mn-fg': '240 230 215',
      '--mn-fg-muted': '180 160 130',
      '--mn-border': '60 50 38',
      '--mn-card': '45 35 26',
      '--mn-accent': '217 119 6',
      '--mn-accent-soft': '90 50 12',
    },
  },
  'sakura-pink': {
    light: {
      '--mn-bg': '253 244 247',
      '--mn-fg': '76 33 50',
      '--mn-fg-muted': '156 110 124',
      '--mn-border': '245 215 226',
      '--mn-card': '255 250 252',
      '--mn-accent': '219 80 124',
      '--mn-accent-soft': '252 232 240',
    },
    dark: {
      '--mn-bg': '28 20 24',
      '--mn-fg': '240 215 222',
      '--mn-fg-muted': '180 140 152',
      '--mn-border': '60 40 50',
      '--mn-card': '42 30 36',
      '--mn-accent': '244 114 182',
      '--mn-accent-soft': '112 26 60',
    },
  },
  'minimal-white': {
    light: {
      '--mn-bg': '255 255 255',
      '--mn-fg': '23 23 23',
      '--mn-fg-muted': '115 115 115',
      '--mn-border': '229 229 229',
      '--mn-card': '250 250 250',
      '--mn-accent': '23 23 23',
      '--mn-accent-soft': '245 245 245',
    },
    dark: {
      '--mn-bg': '10 10 10',
      '--mn-fg': '240 240 240',
      '--mn-fg-muted': '140 140 140',
      '--mn-border': '50 50 50',
      '--mn-card': '23 23 23',
      '--mn-accent': '240 240 240',
      '--mn-accent-soft': '60 60 60',
    },
  },
};

export function applyTheme(theme: ThemeId, mode: Mode): void {
  const root = document.documentElement;
  const tokens = THEME_TOKENS[theme];
  if (!tokens) return;

  // 设置 data-theme / data-mode
  root.dataset.theme = theme;
  if (mode === 'auto') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.mode = isDark ? 'dark' : 'light';
  } else {
    root.dataset.mode = mode;
  }

  // 应用变量
  const t = root.dataset.mode === 'dark' ? tokens.dark : tokens.light;
  for (const [k, v] of Object.entries(t)) {
    root.style.setProperty(k, v);
  }
}

// ========== 排版（字体 / 行高密度）==========

const FONT_FAMILIES: Record<Preferences['font'], string> = {
  system: `system-ui, -apple-system, 'Noto Sans SC', 'Segoe UI', sans-serif`,
  manrope: `'Manrope', 'Noto Sans SC', system-ui, -apple-system, sans-serif`,
  lxgw: `'LXGW WenKai', 'Noto Sans SC', system-ui, serif`,
};

const LINE_HEIGHTS: Record<Preferences['density'], string> = {
  comfortable: '1.85',
  standard: '1.6',
  compact: '1.35',
};

/** 应用字体与行高密度：写入 CSS 变量 --mn-font / --mn-line-height，由 index.css 消费 */
export function applyTypography(font: Preferences['font'], density: Preferences['density']): void {
  const root = document.documentElement;
  root.style.setProperty('--mn-font', FONT_FAMILIES[font]);
  root.style.setProperty('--mn-line-height', LINE_HEIGHTS[density]);
}

export function watchSystemTheme(theme: ThemeId, mode: Mode): () => void {
  if (mode !== 'auto') return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const cb = () => applyTheme(theme, mode);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
