#!/usr/bin/env node
/**
 * 小程序主题令牌生成器（ARCH-R01 收尾）
 *
 * 为什么需要它：小程序拿不到运行时的 `:root` 注入（Taro/weapp 没有 theme.ts 那套 DOM 写入），
 * 所以它的颜色只能落到样式文件里。改造前 `app.scss` 把同一批颜色**抄了四遍**
 * （page 浅色 / @media 深色 / .theme-light / .theme-dark），与 web 的种子表已经漂到
 * 认不出亲缘关系。这里改成从 `@dustnote/shared` 的种子 + 派生规则生成，
 * app.scss 只保留小程序特有的装饰层（半透明叠色、光晕、阴影、圆角、动效）。
 *
 * 用法：
 *   node scripts/gen-mp-tokens.mjs            # 生成 / 覆盖
 *   node scripts/gen-mp-tokens.mjs --check    # 只校验，漂移则 exit 1（CI 用）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_SEEDS, deriveTokens, toHex } from '../shared/dist/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'miniprogram/src/styles/theme-tokens.scss');
/** 小程序的默认主题（玻璃蓝）；改这里等于改小程序的品牌色 */
const THEME_ID = 'liquid-glass';

/** 引擎 token → 小程序现有变量名（保持既有类名不变，app.scss 无需大改） */
const VAR_MAP = {
  '--bg': 'surface-0',
  '--fg': 'text-primary',
  /**
   * 小程序原本有一对**深浅反了**的次要文字色（浅色下 secondary 比 muted 更淡、
   * 暗色下又反过来），且 secondary 带绿味（#5c6b63）与蓝调主题无关。
   * 这里统一到引擎的 text-secondary（AA 达标），并另发一个 text-tertiary 给最弱层级。
   */
  '--fg-secondary': 'text-secondary',
  '--fg-muted': 'text-secondary',
  '--fg-faint': 'text-tertiary',
  '--border-strong': 'border-strong',
  /**
   * 卡片底 / 内嵌底 / 描边 / 强调光晕：以前在 app.scss 的 page、.theme-light、
   * .theme-dark 与 @media(dark) 里各写一份 rgba，等于四套手抄色值 ——
   * 正是阶段 1 要消灭的那类漂移。现在全部由种子派生：
   * bg-elevated 吃 glass-2（卡片那一档），bg-sunken 吃 surface-3，
   * border 吃 glass-line —— 种子里 liquid-glass 的 border 是纯白（那是玻璃高光的语义），
   * 直接发给小程序就是"白卡上的白描边"，完全看不见；border-strong 在暗色下又太亮，
   * 一条 1rpx 的实心亮蓝线会盖过正文。glass-line 才是"分隔"这一档。
   */
  '--bg-elevated': 'glass-2',
  '--bg-sunken': 'surface-3',
  '--border': 'glass-line',
  '--primary-glow': 'accent-soft',
  /** 实色档（material-flat）的卡片底：不透明的 surface-1 */
  '--card-solid': 'surface-1',
  '--primary': 'accent',
  '--primary-strong': 'accent-strong',
  '--primary-deep': 'accent-active',
  '--primary-soft': 'accent-soft',
  /** 强调色当文字用：已保证在各层底色上达 AA（旧值 #3b82f6 在白底只有 3.68:1） */
  '--primary-text': 'accent-text',
  '--success': 'success',
  '--warning': 'warning',
  '--danger': 'danger',
  '--info': 'info',
  '--danger-soft': 'danger-soft',
  '--success-soft': 'success-soft',
  '--warning-soft': 'warning-soft',
};

function block(mode) {
  const d = deriveTokens(THEME_SEEDS[THEME_ID][mode], mode);
  const lines = Object.entries(VAR_MAP).map(([name, key]) => `  ${name}: ${toHex(d[key])};`);
  return lines.join('\n');
}

const out = `/* 生成文件，请勿手改 —— 由 scripts/gen-mp-tokens.mjs 从 @dustnote/shared 的主题种子派生。
 * 想改颜色改 shared/src/theme-seeds.ts；想改变量名改 scripts/gen-mp-tokens.mjs 的 VAR_MAP。
 * 主题：${THEME_ID}（小程序固定一套，不做 7 主题切换：weapp 包体与审核成本不值） */

/* 浅色默认值（page 元素选择器，优先级最低） */
page {
${block('light')}
}

/* 系统深色：仅在没有手动主题类时生效 */
@media (prefers-color-scheme: dark) {
  page {
${indent(block('dark'), 4)}
  }
}

/* 手动浅色（系统深色时反制上面的 @media） */
.theme-light {
${block('light')}
}

/* 手动深色（ThemeVars/useThemeDarkClass 注入根类） */
.theme-dark {
${block('dark')}
}
`;

function indent(s, n) {
  const pad = ' '.repeat(n);
  return s
    .split('\n')
    .map((l) => (l.trim() ? pad + l.trim() : l))
    .join('\n');
}

const check = process.argv.includes('--check');
let current = null;
try {
  current = readFileSync(OUT, 'utf8');
} catch {
  /* 首次生成 */
}
if (check) {
  if (current !== out) {
    console.error('✗ 小程序主题令牌与 shared 种子已漂移，请运行：node scripts/gen-mp-tokens.mjs');
    process.exit(1);
  }
  console.log('✓ 小程序主题令牌与 shared 种子同源');
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, out);
  console.log(
    `✓ 已生成 ${OUT.replace(ROOT + '/', '')}（${Object.keys(VAR_MAP).length} 个颜色变量 × 2 模式）`
  );
}
