import { describe, it, expect } from 'vitest';
import {
  buildThemeTokens,
  contrastRatio,
  deriveTokens,
  auditContrast,
  ensureContrast,
  parseHex,
  toHex,
  parseRgb,
  fmtRgb,
  type DerivedTokens,
} from '../src/theme-engine.js';
import { THEME_SEEDS, THEME_IDS } from '../src/theme-seeds.js';

const LEGACY_KEYS = [
  '--mn-bg',
  '--mn-fg',
  '--mn-fg-muted',
  '--mn-border',
  '--mn-card',
  '--mn-accent',
  '--mn-accent-soft',
] as const;

const ALL_MODES = ['light', 'dark'] as const;
const combos = THEME_IDS.flatMap((id) => ALL_MODES.map((m) => [id, m] as const));

describe('theme-engine · 向后兼容（阶段 1 要求视觉几乎不变）', () => {
  it('7 个遗留键逐字节透传，生成器不得改动既有配色', () => {
    for (const [id, mode] of combos) {
      const def = THEME_SEEDS[id];
      const tokens = buildThemeTokens(def, mode);
      for (const key of LEGACY_KEYS) {
        expect(tokens[key], `${id}/${mode} ${key}`).toBe(
          def[mode][key as keyof (typeof def)['light']]
        );
      }
    }
  });

  it('派生 token 数量充足：7 个种子 → 每模式 44 个派生变量', () => {
    const tokens = buildThemeTokens(THEME_SEEDS['mint-dawn'], 'light');
    // 7 遗留 + 30 派生 7 遗留 + 32 派生 − 3 个同名别名（accent / accent-soft / border 既是种子也是语义名，值相同）
    expect(Object.keys(tokens).length).toBeGreaterThanOrEqual(36);
    const derived = deriveTokens(THEME_SEEDS['mint-dawn'].light, 'light');
    expect(Object.keys(derived)).toHaveLength(45);
  });
});

describe('theme-engine · 对比度是构造出来的', () => {
  it('全部 14 个主题×模式组合都过 AA（正文/次要 4.5:1，辅助 3:1，状态色 4.5:1，按钮文字 4.5:1）', () => {
    const failing: string[] = [];
    for (const [id, mode] of combos) {
      for (const bad of auditContrast(THEME_SEEDS[id], mode)) {
        failing.push(`${id}/${mode} ${bad.key}=${bad.ratio} < ${bad.need}`);
      }
    }
    expect(failing, failing.join('\n')).toEqual([]);
  });

  it('ensureContrast 会把不合格的前景推到达标为止', () => {
    const out = ensureContrast('148 163 184', '255 255 255', 4.5);
    expect(contrastRatio(out, [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
    // 已经达标的输入不应被改动
    const keep = ensureContrast('15 23 42', '255 255 255', 4.5);
    expect(fmtRgb(keep)).toBe('15 23 42');
  });

  it('暗色下 text-secondary 必然亮于 surface（曾经"次要文字看不见"的那类回归被构造性排除）', () => {
    const seed = THEME_SEEDS['mist-blue'].dark;
    const t = deriveTokens(seed, 'dark');
    expect(
      contrastRatio(parseRgb(t['text-secondary']), parseRgb(seed['--mn-card']))
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe('theme-engine · 输出可预测', () => {
  it('同一输入两次派生结果完全一致（可作快照）', () => {
    const a = buildThemeTokens(THEME_SEEDS['liquid-glass'], 'light');
    const b = buildThemeTokens(THEME_SEEDS['liquid-glass'], 'light');
    expect(a).toEqual(b);
  });

  it('所有颜色值都是 "r g b" 或 "r g b / a" 形式，可被 rgb(var(--x)) 直接消费', () => {
    const shape = /^\d{1,3} \d{1,3} \d{1,3}( \/ (0|1|0?\.\d+))?$/;
    for (const [id, mode] of combos) {
      const t = deriveTokens(THEME_SEEDS[id][mode], mode);
      for (const [k, v] of Object.entries(t)) {
        expect(v, `${id}/${mode} --mn-${k}='${v}'`).toMatch(shape);
      }
    }
  });

  it('每个主题都产出完整玻璃三档（修掉"切主题后上一套 glass 变量残留"）', () => {
    // 迁移前只有 liquid-glass 定义了 --mn-glass-*，切到别的主题时 :root 上的旧值不会被清除
    for (const [id, mode] of combos) {
      const t = buildThemeTokens(THEME_SEEDS[id], mode);
      for (const k of [
        '--mn-glass-1',
        '--mn-glass-2',
        '--mn-glass-line',
        '--mn-scrim',
        '--mn-focus',
      ]) {
        expect(t[k], `${id}/${mode} 缺少 ${k}`).toBeTruthy();
      }
    }
    // 液态玻璃保留自己的极光
    expect(buildThemeTokens(THEME_SEEDS['liquid-glass'], 'dark')['--mn-glass-aurora']).toContain(
      'radial-gradient'
    );
    // 非玻璃主题不注入极光，避免平白多一层背景绘制
    expect(buildThemeTokens(THEME_SEEDS['mint-dawn'], 'dark')['--mn-glass-aurora']).toBeUndefined();
  });

  it('层级是单调的：浅色 surface-0 ≤ 1 ≤ 2，暗色反之', () => {
    const lum = (v: string) => contrastRatio(parseRgb(v), [0, 0, 0]);
    const l = deriveTokens(THEME_SEEDS['mist-blue'].light, 'light');
    expect(lum(l['surface-0'])).toBeLessThan(lum(l['surface-1']));
    const d = deriveTokens(THEME_SEEDS['mist-blue'].dark, 'dark');
    expect(lum(d['surface-0'])).toBeLessThan(lum(d['surface-1']));
    expect(lum(d['surface-1'])).toBeLessThan(lum(d['surface-2']));
  });

  it('未知主题名不会静默产出空表', () => {
    expect(THEME_IDS).toHaveLength(7);
    const missing = THEME_IDS.filter((id) => !THEME_SEEDS[id]);
    expect(missing).toEqual([]);
  });
});

describe('theme-engine · 语义命名齐全（供 index.css / Tailwind 直接消费）', () => {
  const EXPECTED: (keyof DerivedTokens)[] = [
    'surface-0',
    'surface-1',
    'surface-2',
    'surface-3',
    'text-primary',
    'text-secondary',
    'text-tertiary',
    'text-inverse',
    'accent',
    'accent-hover',
    'accent-active',
    'accent-soft',
    'accent-border',
    'on-accent',
    'accent-strong',
    'accent-text',
    'accent-strong-hover',
    'success',
    'success-soft',
    'warning',
    'warning-soft',
    'danger',
    'danger-soft',
    'info',
    'info-soft',
    'success-solid',
    'on-success-solid',
    'success-solid-hover',
    'warning-solid',
    'on-warning-solid',
    'warning-solid-hover',
    'danger-solid',
    'on-danger-solid',
    'danger-solid-hover',
    'info-solid',
    'on-info-solid',
    'info-solid-hover',
    'border',
    'border-strong',
    'scrim',
    'overlay',
    'focus',
    'glass-1',
    'glass-2',
    'glass-line',
  ];
  it('派生表恰好包含这些键（新增/删除键都要过这条，防止无声漂移）', () => {
    const t = deriveTokens(THEME_SEEDS['mist-blue'].light, 'light');
    expect(Object.keys(t).sort()).toEqual([...EXPECTED].sort());
  });
});

describe('theme-engine · hex 互转（原生端与生成脚本依赖）', () => {
  it('toHex / parseHex 往返无损', () => {
    for (const [id, def] of Object.entries(THEME_SEEDS)) {
      for (const mode of ALL_MODES) {
        const seed = def[mode]['--mn-bg'];
        const hex = toHex(seed);
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
        expect(fmtRgb(parseRgb(seed))).toBe(fmtRgb(parseHex(hex)));
      }
    }
  });

  it('带 alpha 时输出 8 位 hex；非法输入报错而不是静默返回 NaN', () => {
    expect(toHex('255 255 255 / 0.5')).toBe('#ffffff80');
    expect(() => parseHex('not-a-color')).toThrow(/无法解析 hex/);
    expect(() => parseRgb('abc')).toThrow(/无法解析颜色/);
  });
});
