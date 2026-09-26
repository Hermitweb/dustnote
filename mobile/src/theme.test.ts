/**
 * 主题同源回归测试（ARCH-R01）
 *
 * `mobile/src/theme.ts` 改造前手抄了 98 个 hex，与 web 的种子表已经漂移。
 * 现在颜色由 `@dustnote/shared/theme-engine` 派生，这份测试锁两件事：
 * 1. **6 套主题逐字节不变** —— 迁移不是"顺手改色"，安卓端观感必须一致；
 * 2. **liquid-glass 的漂移被纠正到与 web 相同** —— 唯一允许的差异，且是刻意的修复。
 */
import { describe, it, expect } from 'vitest';
import { THEME_SEEDS, deriveTokens, contrastRatio, toHex, parseHex } from '@dustnote/shared';
import {
  THEMES,
  paletteFor,
  LIQUID_GLASS_GRADIENT,
  type ThemeId,
  type ThemePalette,
} from './theme';

/** 改造前 mobile/src/theme.ts 里手抄的调色板（迁移基线，勿改） */
const LEGACY: Record<string, ThemePalette> = {
  'mint-dawn.light': {
    bg: '#F7FAF7',
    card: '#FFFFFF',
    fg: '#1E293B',
    muted: '#64748B',
    border: '#E2E8F0',
    accent: '#16A34A',
    accentSoft: '#DCFCE7',
    accentStrong: '',
    accentText: '',
  },
  'mint-dawn.dark': {
    bg: '#0F172A',
    card: '#1E293B',
    fg: '#E2E8F0',
    muted: '#94A3B8',
    border: '#334155',
    accent: '#4ADE80',
    accentSoft: '#14532D',
    accentStrong: '',
    accentText: '',
  },
  'mist-blue.light': {
    bg: '#F1F5F9',
    card: '#FFFFFF',
    fg: '#0F172A',
    muted: '#475569',
    border: '#CBD5E1',
    accent: '#3B82F6',
    accentSoft: '#DBEAFE',
    accentStrong: '',
    accentText: '',
  },
  'mist-blue.dark': {
    bg: '#0F172A',
    card: '#1E293B',
    fg: '#E2E8F0',
    muted: '#94A3B8',
    border: '#334155',
    accent: '#60A5FA',
    accentSoft: '#1E3A8A',
    accentStrong: '',
    accentText: '',
  },
  'dusk-forest.light': {
    bg: '#F5F6F0',
    card: '#FFFFFF',
    fg: '#1D2924',
    muted: '#576056',
    border: '#D7DED1',
    accent: '#657B4E',
    accentSoft: '#E6EEDA',
    accentStrong: '',
    accentText: '',
  },
  'dusk-forest.dark': {
    bg: '#141E18',
    card: '#202D24',
    fg: '#DCE6D7',
    muted: '#94A390',
    border: '#323C32',
    accent: '#94B871',
    accentSoft: '#374E29',
    accentStrong: '',
    accentText: '',
  },
  'caramel-warm.light': {
    bg: '#FCF8F3',
    card: '#FFFAF0',
    fg: '#3F2719',
    muted: '#78604E',
    border: '#E9DCC6',
    accent: '#B45309',
    accentSoft: '#FEF3C7',
    accentStrong: '',
    accentText: '',
  },
  'caramel-warm.dark': {
    bg: '#1C1610',
    card: '#2D231A',
    fg: '#F0E6D7',
    muted: '#B4A082',
    border: '#3C3226',
    accent: '#D97706',
    accentSoft: '#5A320C',
    accentStrong: '',
    accentText: '',
  },
  'sakura-pink.light': {
    bg: '#FDF4F7',
    card: '#FFFAFC',
    fg: '#4C2132',
    muted: '#9C6E7C',
    border: '#F5D7E2',
    accent: '#DB507C',
    accentSoft: '#FCE8F0',
    accentStrong: '',
    accentText: '',
  },
  'sakura-pink.dark': {
    bg: '#1C1418',
    card: '#2A1E24',
    fg: '#F0D7DE',
    muted: '#B48C98',
    border: '#3C2832',
    accent: '#F472B6',
    accentSoft: '#701A3C',
    accentStrong: '',
    accentText: '',
  },
  'minimal-white.light': {
    bg: '#FFFFFF',
    card: '#FAFAFA',
    fg: '#171717',
    muted: '#737373',
    border: '#E5E5E5',
    accent: '#171717',
    accentSoft: '#F5F5F5',
    accentStrong: '',
    accentText: '',
  },
  'minimal-white.dark': {
    bg: '#0A0A0A',
    card: '#171717',
    fg: '#F0F0F0',
    muted: '#8C8C8C',
    border: '#323232',
    accent: '#F0F0F0',
    accentSoft: '#3C3C3C',
    accentStrong: '',
    accentText: '',
  },
};

const BASE_KEYS = ['bg', 'card', 'fg', 'muted', 'border', 'accent', 'accentSoft'] as const;
const MODES = ['light', 'dark'] as const;

/** 引擎侧的 7 个基础色（不含 RN 专属 alpha） */
function engineBase(id: ThemeId, mode: 'light' | 'dark') {
  const seed = THEME_SEEDS[id][mode];
  return {
    bg: toHex(seed['--mn-bg']),
    card: toHex(seed['--mn-card']),
    fg: toHex(seed['--mn-fg']),
    muted: toHex(seed['--mn-fg-muted']),
    border: toHex(seed['--mn-border']),
    accent: toHex(seed['--mn-accent']),
    accentSoft: toHex(seed['--mn-accent-soft']),
  };
}

describe('mobile 主题与 web 种子同源（ARCH-R01）', () => {
  it('12 个「主题 × 模式」组合的 7 个基础色与迁移前逐字节一致', () => {
    const keys = Object.keys(LEGACY);
    expect(keys).toHaveLength(12);
    for (const key of keys) {
      const [id, mode] = key.split('.') as [ThemeId, 'light' | 'dark'];
      const got = engineBase(id, mode);
      const want = LEGACY[key];
      for (const k of BASE_KEYS) {
        expect(`${key}.${k}: ${got[k]}`).toBe(`${key}.${k}: ${want[k].toLowerCase()}`);
      }
    }
  });

  it('liquid-glass 的安卓漂移已纠正到与 web 相同（记录被修掉的具体值）', () => {
    const drift: Record<string, [string, string]> = {
      'light.bg': ['#eaeff8', engineBase('liquid-glass', 'light').bg],
      'dark.bg': ['#0a1128', engineBase('liquid-glass', 'dark').bg],
      'dark.card': ['#334155', engineBase('liquid-glass', 'dark').card],
      'dark.border': ['#93c5fd', engineBase('liquid-glass', 'dark').border],
      'dark.accent': ['#3b82f6', engineBase('liquid-glass', 'dark').accent],
    };
    for (const [k, [was, now]] of Object.entries(drift)) {
      // 漂移确实存在（否则测试在保护一个已不存在的事实），且现在等于 web 种子
      expect(now, k).not.toBe(was);
      expect(now, k).toBe(
        toHex(
          THEME_SEEDS['liquid-glass'][k.startsWith('light') ? 'light' : 'dark'][
            k.includes('card')
              ? '--mn-card'
              : k.includes('border')
                ? '--mn-border'
                : k.includes('accent')
                  ? '--mn-accent'
                  : '--mn-bg'
          ]
        )
      );
    }
    // 深色主题里 accent 本身很亮（#7dd3fc 上放白字只有 1.75:1），
    // 所以主按钮必须走 accentStrong；旧安卓直接拿 #3b82f6 当按钮底也只有 3.68:1，同样不达标。
    expect(contrastRatio(parseHex('#7dd3fc'), parseHex('#ffffff'))).toBeLessThan(2);
    expect(contrastRatio(parseHex('#3b82f6'), parseHex('#ffffff'))).toBeLessThan(4.5);
  });

  it('RN 专属玻璃 alpha 仍保留（平台渲染限制，不是配色决定）', () => {
    const light = paletteFor('liquid-glass', 'light');
    const dark = paletteFor('liquid-glass', 'dark');
    expect(light.card).toBe(`${engineBase('liquid-glass', 'light').card}a6`);
    expect(light.border).toBe(`${engineBase('liquid-glass', 'light').border}aa`);
    expect(dark.card.endsWith('b3')).toBe(true);
    expect(dark.border.endsWith('66')).toBe(true);
    // 非玻璃主题不吃 alpha
    expect(paletteFor('mist-blue', 'dark').card).toBe(engineBase('mist-blue', 'dark').card);
  });

  it('accentStrong 容得下白字、accentText 在卡片上达 AA（引擎保证，逐主题抽查）', () => {
    for (const { id } of THEMES) {
      for (const mode of MODES) {
        const d = deriveTokens(THEME_SEEDS[id][mode], mode);
        const p = paletteFor(id, mode);
        expect(
          contrastRatio(parseHex(toHex(d['accent-strong'])), parseHex('#ffffff')),
          `${id}.${mode} accentStrong`
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(parseHex(toHex(d['accent-text'])), parseHex(p.card)),
          `${id}.${mode} accentText`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('极光渐变基色跟随引擎 bg', () => {
    expect(LIQUID_GLASS_GRADIENT.light[0]).toBe(engineBase('liquid-glass', 'light').bg);
    expect(LIQUID_GLASS_GRADIENT.dark[0]).toBe(engineBase('liquid-glass', 'dark').bg);
  });
});
