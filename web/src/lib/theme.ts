/**
 * 主题系统 · 6 主题 × 3 模式（light / dark / auto）
 *
 * v2.6 起本文件**不再持有任何色值**：种子表与派生规则都在 `@dustnote/shared/theme-engine`，
 * 这里只负责把它写进 DOM。目的是关闭审计项 `ARCH-R01`（token 单一源）——
 * 改造前这里有 98 个手写色值，mobile / miniprogram 又各抄一份，四端必然漂移。
 *
 * 详见 docs/ui-optimization.md §1（U-2 / U-3）与 §2.2（玻璃三档）。
 */

import { THEME_SEEDS, buildThemeTokens } from '@dustnote/shared';
import type { ThemeId, Mode, Preferences } from './store';

/** 主题元信息：id 必须与 shared 的种子表一致（下面有编译期外的自检） */
export const THEMES: { id: ThemeId; name: string }[] = [
  { id: 'mint-dawn', name: '尘心晨光' },
  { id: 'mist-blue', name: '雾霭蓝调' },
  { id: 'dusk-forest', name: '暮色森林' },
  { id: 'caramel-warm', name: '焦糖暖光' },
  { id: 'sakura-pink', name: '樱粉物语' },
  { id: 'minimal-white', name: '极简白' },
  { id: 'liquid-glass', name: '液态玻璃' },
];

// 防漂移：UI 列表与 shared 种子表必须一一对应（新增主题只改 shared 就会在这里报错）
for (const t of THEMES) {
  if (!THEME_SEEDS[t.id]) {
    throw new Error(`theme: '${t.id}' 在 @dustnote/shared 的种子表里不存在`);
  }
}

/** 上一次写入 :root 的变量名集合，用于精确清除，避免切主题后残留旧值 */
let appliedKeys = new Set<string>();

function resolveMode(mode: Mode): 'light' | 'dark' {
  if (mode !== 'auto') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * 应用主题：写入全部种子 + 派生 token。
 *
 * 为什么要清 stale：改造前只有 liquid-glass 定义 `--mn-glass-*`，
 * 从它切到别的主题时旧值会留在 `:root` 上继续生效（玻璃残留 bug）。
 * 现在每个主题都会产出完整 token 集，再额外清除上一轮写入但本轮没有的键。
 */
export function applyTheme(theme: ThemeId, mode: Mode): void {
  const root = document.documentElement;
  const def = THEME_SEEDS[theme];
  if (!def) return;

  const resolved = resolveMode(mode);
  root.dataset.theme = theme;
  root.dataset.mode = resolved;

  const tokens = buildThemeTokens(def, resolved);
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);

  for (const stale of appliedKeys) {
    if (!(stale in tokens)) root.style.removeProperty(stale);
  }
  appliedKeys = new Set(Object.keys(tokens));
}

// ========== 排版（字体 / 行高密度）==========

const FONT_FAMILIES: Record<Preferences['font'], string> = {
  system: `system-ui, -apple-system, 'Noto Sans SC', 'Segoe UI', sans-serif`,
  manrope: `'Manrope', 'Noto Sans SC', system-ui, -apple-system, sans-serif`,
  lxgw: `'LXGW WenKai', 'Noto Sans SC', system-ui, serif`,
};

/**
 * 密度同时改**字号 + 行高 + 间距**（改造前只改行高，切换几乎无感知，功能显得是假的）。
 * 见 docs/ui-optimization.md U-5。
 */
const TYPOGRAPHY: Record<
  Preferences['density'],
  { lineHeight: string; base: string; scale: string; space: string }
> = {
  comfortable: { lineHeight: '1.85', base: '15px', scale: '1.13', space: '1.08' },
  standard: { lineHeight: '1.6', base: '14px', scale: '1.1', space: '1' },
  compact: { lineHeight: '1.35', base: '13px', scale: '1.07', space: '0.9' },
};

/** 写入 CSS 变量，由 index.css / Tailwind 消费 */
export function applyTypography(font: Preferences['font'], density: Preferences['density']): void {
  const root = document.documentElement;
  const t = TYPOGRAPHY[density] ?? TYPOGRAPHY.standard;
  root.style.setProperty('--mn-font', FONT_FAMILIES[font]);
  root.style.setProperty('--mn-line-height', t.lineHeight);
  root.style.setProperty('--mn-text-base', t.base);
  root.style.setProperty('--mn-type-scale', t.scale);
  root.style.setProperty('--mn-space-scale', t.space);
}

export function watchSystemTheme(theme: ThemeId, mode: Mode): () => void {
  if (mode !== 'auto') return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const cb = () => applyTheme(theme, mode);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
