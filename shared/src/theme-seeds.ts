/**
 * 7 套主题的**种子表**（唯一真相源）
 *
 * 迁移自 `web/src/lib/theme.ts` 的 `THEME_TOKENS`（98 个手写色值）。
 * 这里只保留"人做决定的那部分"——每套主题每模式 7 个基础色；
 * 其余约 30 个语义 token 由 `theme-engine.ts` 派生，不再手写。
 *
 * 四端共用：web / desktop 直接消费；mobile / miniprogram 接入时读同一份，
 * 这是关闭审计项 `ARCH-R01`（token 单一源）的落点。
 */
import type { ThemeDef } from './theme-engine.js';

export const THEME_SEEDS: Record<string, ThemeDef> = {
  'mint-dawn': {
    id: 'mint-dawn',
    name: '尘心晨光',
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
    id: 'mist-blue',
    name: '雾霭蓝调',
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
    id: 'dusk-forest',
    name: '暮色森林',
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
    id: 'caramel-warm',
    name: '焦糖暖光',
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
    id: 'sakura-pink',
    name: '樱粉物语',
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
    id: 'minimal-white',
    name: '极简白',
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
  /**
   * 液态玻璃：唯一自带极光与磨砂材质的主题。
   * `--mn-glass-aurora` 是 CSS 图像值（不是三元组），只能作为 passthrough 提供。
   */
  'liquid-glass': {
    id: 'liquid-glass',
    name: '液态玻璃',
    light: {
      '--mn-bg': '228 235 248',
      '--mn-fg': '15 23 42',
      '--mn-fg-muted': '71 85 105',
      '--mn-border': '255 255 255',
      '--mn-card': '255 255 255',
      '--mn-accent': '59 130 246',
      '--mn-accent-soft': '219 234 254',
    },
    dark: {
      '--mn-bg': '9 17 40',
      '--mn-fg': '226 232 240',
      '--mn-fg-muted': '148 163 184',
      '--mn-border': '96 165 250',
      '--mn-card': '23 37 84',
      '--mn-accent': '125 211 252',
      '--mn-accent-soft': '30 58 138',
    },
    passthrough: {
      light: {
        '--mn-glass-surface': '255 255 255 / 0.4',
        '--mn-glass-surface-bg': '255 255 255 / 0.42',
        '--mn-glass-border': '255 255 255 / 0.8',
        '--mn-glass-button': '59 130 246',
        '--mn-glass-aurora':
          'radial-gradient(1200px 820px at 10% -12%, rgb(59 130 246 / 0.6), transparent 60%), radial-gradient(1000px 720px at 112% 6%, rgb(99 102 241 / 0.5), transparent 55%), radial-gradient(920px 900px at 50% 124%, rgb(34 211 238 / 0.48), transparent 60%), radial-gradient(760px 640px at 82% 78%, rgb(56 189 248 / 0.34), transparent 62%)',
      },
      dark: {
        '--mn-glass-surface': '30 41 59 / 0.74',
        '--mn-glass-surface-bg': '15 23 42 / 0.6',
        '--mn-glass-border': '147 197 253 / 0.42',
        '--mn-glass-button': '37 99 235',
        '--mn-glass-aurora':
          'radial-gradient(1200px 820px at 10% -12%, rgb(56 189 248 / 0.4), transparent 60%), radial-gradient(1000px 720px at 112% 6%, rgb(99 102 241 / 0.38), transparent 55%), radial-gradient(920px 900px at 50% 124%, rgb(37 99 235 / 0.4), transparent 60%), radial-gradient(760px 640px at 82% 78%, rgb(34 211 238 / 0.28), transparent 62%)',
      },
    },
  },
};

export const THEME_IDS = Object.keys(THEME_SEEDS);
