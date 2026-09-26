/**
 * 主题 token 生成器（UI 阶段 1.2 / 1.3）
 *
 * 背景：改造前全仓只有 14 个 CSS 变量，7 主题 × 2 模式 = 98 个手写色值，
 * 没有 surface 层级、没有语义状态色、没有玻璃档 —— 于是暗色只能"给渐变蒙层灰"，
 * 一个 accent 变量身兼按钮/链接/引用条/高亮/焦点六职。详见 docs/ui-optimization.md U-2 / U-4。
 *
 * 三条设计原则：
 * 1. **向后兼容**：7 个遗留键（`--mn-bg` 等）原样透传，值不变 —— 阶段 1 要求"视觉几乎不变"；
 * 2. **派生而非手写**：新增的 surface 层级 / 文本层级 / 语义状态色 / 玻璃材质全部由种子推导；
 * 3. **对比度是构造出来的，不是祈祷出来的**：任何文字色与状态色都会被自动推到
 *    它可能出现的**每一层承载面**上都达标（页面底 / 卡片 / 内嵌底取最差值）。
 *    开发本模块时实测抓到：樱粉浅色主题的 `--mn-fg-muted` 在卡片上 4.60 达标、
 *    在页面底上只有 4.41 —— 只按 card 算就会漏掉这一整类"暗色/浅底下次要文字看不见"的回归。
 *
 * 纯函数、无 DOM、无依赖：四端（web / desktop / mobile / miniprogram）共用同一份实现，
 * 也是关闭审计项 `ARCH-R01`（token 单一源）的落点。
 */

export type Mode = 'light' | 'dark';

/** CSS `rgb()` 空格语法三元组，如 `'247 250 247'`；带 alpha 时为 `'r g b / a'` */
export type RgbString = string;

/** 一个主题在某模式下的**种子**：就是改造前手写的 7 个基础色 */
export interface ThemeSeed {
  '--mn-bg': RgbString;
  '--mn-fg': RgbString;
  '--mn-fg-muted': RgbString;
  '--mn-border': RgbString;
  '--mn-card': RgbString;
  '--mn-accent': RgbString;
  '--mn-accent-soft': RgbString;
}

/** 主题定义：两套种子 + 可选的透传变量（如液态玻璃的极光） */
export interface ThemeDef {
  id: string;
  name: string;
  light: ThemeSeed;
  dark: ThemeSeed;
  /** 原样透传的额外变量。`--mn-glass-aurora` 是 CSS 图像值而非三元组，只能走这里 */
  passthrough?: { light?: Record<string, string>; dark?: Record<string, string> };
}

type Rgb = [number, number, number];

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];
/** 取整余量：输出是整数三元组，四舍五入会把压线的 4.50 拉成 4.41，所以内部多要一点 */
const EPS = 0.08;

/* ---------------------------------- 颜色工具 ---------------------------------- */

export function parseRgb(value: RgbString): Rgb {
  // 不用字符类里的 /：既躲开打包器对 `/[\s,/]+/` 的解析歧义，也躲开 eslint 的 no-useless-escape。
  const nums = value
    .trim()
    .split(/\s+/)
    .filter((x) => /^[0-9.]+$/.test(x))
    .slice(0, 3)
    .map(Number);
  if (nums.length !== 3 || nums.some((n) => !Number.isFinite(n))) {
    throw new Error(`theme-engine: 无法解析颜色 '${value}'`);
  }
  return nums as unknown as Rgb;
}

export function fmtRgb(rgb: Rgb): RgbString {
  return rgb.map((n) => Math.round(clamp(n, 0, 255))).join(' ');
}

/** 带 alpha 的输出（供 `rgb(var(--x))` 消费） */
export function fmtRgba(rgb: Rgb, alpha: number): RgbString {
  return `${fmtRgb(rgb)} / ${Math.round(alpha * 100) / 100}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** 通道线性插值：t=0 取 a，t=1 取 b */
export function mix(a: RgbString | Rgb, b: RgbString | Rgb, t: number): Rgb {
  const x = typeof a === 'string' ? parseRgb(a) : a;
  const y = typeof b === 'string' ? parseRgb(b) : b;
  const k = clamp(t, 0, 1);
  return [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
}

/** WCAG 2.x 相对亮度 */
export function relativeLuminance(color: RgbString | Rgb): number {
  const [r, g, b] = ((typeof color === 'string' ? parseRgb(color) : color) as Rgb).map((v) => {
    const s = clamp(v, 0, 255) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度（1..21） */
export function contrastRatio(a: RgbString | Rgb, b: RgbString | Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* -------------------------------- 对比度保证机制 -------------------------------- */

/**
 * 归一化"承载面"入参。
 *
 * 坑点：`Rgb` 本身就是数组，所以 `Array.isArray(x)` 无法区分"一个颜色"与"一组颜色"。
 * 用首元素判别：首元素是数组或字符串 → 这是一组；否则它自己就是一个三元组。
 * 判错会让 `contrastRatio(color, 0)` 拿到 number 而抛 ".map is not a function"。
 */
function asRgbList(surfaces: RgbString | Rgb | (RgbString | Rgb)[]): Rgb[] {
  const toRgb = (s: RgbString | Rgb): Rgb => (typeof s === 'string' ? parseRgb(s) : s);
  if (Array.isArray(surfaces)) {
    const first = (surfaces as unknown[])[0] as unknown;
    if (Array.isArray(first) || typeof first === 'string') {
      return (surfaces as (RgbString | Rgb)[]).map(toRgb);
    }
    return [surfaces as unknown as Rgb];
  }
  return [toRgb(surfaces)];
}

/** 一个颜色在所有承载面上的最差对比度 */
export function worstContrast(color: Rgb, surfaces: Rgb[]): number {
  return Math.min(...surfaces.map((s) => contrastRatio(color, s)));
}

function walkToward(a: Rgb, b: Rgb, surfaces: Rgb[], target: number, steps = 40): Rgb {
  const need = target + EPS;
  for (let i = 1; i <= steps; i++) {
    const cand = mix(a, b, i / steps);
    if (worstContrast(cand, surfaces) >= need) return cand;
  }
  return b;
}

/**
 * 把前景推到与**所有承载面**的对比度都达标。
 *
 * 方向为什么不能只看背景明暗：中亮度背景（`#16A34A` 绿、`#3B82F6` 蓝）配白字只有 3:1，
 * 此时正确解是往黑走；"背景不够亮就往白推"的直觉会把白色推向白色，永远不达标。
 * 所以两条路都试：都达标取改动小的（保住品牌冷暖倾向），否则取对比度高的。
 */
export function ensureContrast(
  fg: RgbString | Rgb,
  surfaces: RgbString | Rgb | (RgbString | Rgb)[],
  target: number
): Rgb {
  const list = asRgbList(surfaces);
  const c = typeof fg === 'string' ? parseRgb(fg) : fg;
  if (worstContrast(c, list) >= target) return c;
  const darker = walkToward(c, BLACK, list, target);
  const lighter = walkToward(c, WHITE, list, target);
  const kd = worstContrast(darker, list);
  const kl = worstContrast(lighter, list);
  if (kd >= target && kl >= target) {
    const move = (x: Rgb) => Math.abs(x[0] - c[0]) + Math.abs(x[1] - c[1]) + Math.abs(x[2] - c[2]);
    return move(darker) <= move(lighter) ? darker : lighter;
  }
  return kd >= kl ? darker : lighter;
}

/** 先沿 a→b（通常是"往主文字色靠"）走，尽量保住原色相；不行再交给 ensureContrast */
function adjustToward(a: Rgb, b: Rgb, surfaces: Rgb[], target: number): Rgb {
  const direct = walkToward(a, b, surfaces, target);
  if (worstContrast(direct, surfaces) >= target + EPS) return direct;
  return ensureContrast(a, surfaces, target);
}

/* ---------------------------------- 语义色板 ---------------------------------- */

/**
 * 语义状态色的**基准色相**（非最终值）。最终值会先按主题中性色微调，
 * 再被推到 AA —— 所以焦糖棕主题的成功绿不会突然变荧光。
 */
const STATE_BASE: Record<Mode, Record<'success' | 'warning' | 'danger' | 'info', Rgb>> = {
  light: {
    success: [21, 128, 61],
    warning: [180, 83, 9],
    danger: [185, 28, 28],
    info: [3, 105, 161],
  },
  dark: {
    success: [74, 222, 128],
    warning: [251, 191, 36],
    danger: [248, 113, 113],
    info: [56, 189, 248],
  },
};

/**
 * 实心状态底（toast / 危险按钮 / 状态徽标）。
 *
 * 不能直接拿 `danger` 当背景：那一档是"**作为文字色**在各承载面上达 AA"推导出来的，
 * 暗色档它必然偏亮（否则在小字号下读不出来），白字压上去就掉档 —— 改造前界面靠
 * 手写 `bg-red-600` 躲过了这个问题，代价是不跟主题走、且 hover 时叠白又掉回 3.9:1。
 * 这里把两件事分开：保住状态色相，再在"压暗配白字"与"提亮配墨字"里取改动小的一条。
 */
function solidState(base: Rgb): { bg: Rgb; on: Rgb; hover: Rgb } {
  const darkBg = walkToward(base, BLACK, [WHITE], 4.5);
  const darkOk = contrastRatio(WHITE, darkBg) >= 4.5 + EPS;
  if (darkOk) return { bg: darkBg, on: WHITE, hover: mix(darkBg, BLACK, 0.14) };
  const lightBg = walkToward(base, WHITE, [BLACK], 4.5);
  if (contrastRatio(BLACK, lightBg) >= 4.5 + EPS)
    return { bg: lightBg, on: BLACK, hover: mix(lightBg, WHITE, 0.14) };
  // 两条路都不达标时取更好的那条（实测七套主题 × 两模式都走不到这里，留着兜底）
  return contrastRatio(WHITE, darkBg) >= contrastRatio(BLACK, lightBg)
    ? { bg: darkBg, on: WHITE, hover: mix(darkBg, BLACK, 0.14) }
    : { bg: lightBg, on: BLACK, hover: mix(lightBg, WHITE, 0.14) };
}

export interface DerivedTokens {
  /* 层级 */
  'surface-0': RgbString;
  'surface-1': RgbString;
  'surface-2': RgbString;
  'surface-3': RgbString;
  /* 文本 */
  'text-primary': RgbString;
  'text-secondary': RgbString;
  'text-tertiary': RgbString;
  'text-inverse': RgbString;
  /* 强调 */
  accent: RgbString;
  'accent-hover': RgbString;
  'accent-active': RgbString;
  'accent-soft': RgbString;
  'accent-border': RgbString;
  'on-accent': RgbString;
  /** 把强调色压暗到「白字必然 AA」的主按钮底（A11Y-R01 的手工做法自动化） */
  'accent-strong': RgbString;
  /** 主按钮 hover：只往更深走一档，白字对比度只会升不会降 */
  'accent-strong-hover': RgbString;
  /**
   * 强调色**当文字用**时的版本：保证在页面底 / 卡片 / 内嵌底上都达 AA。
   * 品牌蓝 #3B82F6 在白底只有 3.68:1 —— 直接拿 accent 当链接色/标签色会成片不达标，
   * 这是 e2e 对比度门禁在本仓库实测到的 7 处缺陷的共同根因。
   */
  'accent-text': RgbString;
  /* 语义状态 */
  success: RgbString;
  'success-soft': RgbString;
  warning: RgbString;
  'warning-soft': RgbString;
  danger: RgbString;
  'danger-soft': RgbString;
  info: RgbString;
  'info-soft': RgbString;
  /** 实心状态底：白字/墨字必然 AA，另给一条只会**加深**的 hover 档 */
  'success-solid': RgbString;
  'on-success-solid': RgbString;
  'success-solid-hover': RgbString;
  'warning-solid': RgbString;
  'on-warning-solid': RgbString;
  'warning-solid-hover': RgbString;
  'danger-solid': RgbString;
  'on-danger-solid': RgbString;
  'danger-solid-hover': RgbString;
  'info-solid': RgbString;
  'on-info-solid': RgbString;
  'info-solid-hover': RgbString;
  /* 边界与遮罩 */
  border: RgbString;
  'border-strong': RgbString;
  scrim: RgbString;
  overlay: RgbString;
  focus: RgbString;
  /* 玻璃三档（docs/ui-optimization.md §2.2） */
  'glass-1': RgbString;
  'glass-2': RgbString;
  'glass-line': RgbString;
}

/**
 * 由 7 个种子色派生全部语义 token。
 *
 * **不修改种子本身**：`surface-0/1` 就是 `bg`/`card`，`text-primary` 就是 `fg`，
 * 因此接入生成器后现有界面逐像素不变；新增层只是把隐式约定写成显式变量。
 */
export function deriveTokens(seed: ThemeSeed, mode: Mode): DerivedTokens {
  const dark = mode === 'dark';
  const bg = parseRgb(seed['--mn-bg']);
  const card = parseRgb(seed['--mn-card']);
  const fg = parseRgb(seed['--mn-fg']);
  const muted = parseRgb(seed['--mn-fg-muted']);
  const border = parseRgb(seed['--mn-border']);
  const accent = parseRgb(seed['--mn-accent']);
  const accentSoft = parseRgb(seed['--mn-accent-soft']);
  const ink = dark ? WHITE : BLACK;

  // 层级：surface-2 在卡片上再抬一层，surface-3 是内嵌/悬停底
  const surface2: Rgb = dark ? mix(card, WHITE, 0.06) : mix(card, BLACK, 0.015);
  const surface3: Rgb = mix(bg, fg, dark ? 0.1 : 0.06);
  /**
   * 文字与状态色可能在每一层出现，所以按最差面保证。
   *
   * 玻璃面板也必须进这个集合：它是半透明的（glass-1 = card/白 @ .60 暗 / .74 浅，
   * glass-2 = @ .80 / .88），底下还会透出极光。只看实心 card 会漏掉一整类问题 ——
   * 实测就是暗色设置弹窗里的「退出登录」：实心卡上 AA，落到 glass-2 上只剩 3.04:1。
   * 最差情况取"透出来的那一层全是 accent"（极光的主体色），比实际更严一档。
   */
  const glassBase = dark ? card : WHITE;
  const glassWorst = (alpha: number): Rgb => mix(mix(bg, glassBase, alpha), accent, 1 - alpha);
  const surfaces: Rgb[] = [
    bg,
    card,
    surface2,
    surface3,
    glassWorst(dark ? 0.6 : 0.74), // glass-1：顶栏 / 导航轨
    glassWorst(dark ? 0.8 : 0.88), // glass-2：卡片 / 弹窗 / 阅读纸张
  ];

  const accentHover = mix(accent, ink, dark ? 0.14 : 0.12);
  const accentActive = mix(accent, ink, dark ? 0.24 : 0.22);
  const onAccent = ensureContrast(
    contrastRatio(WHITE, accent) >= contrastRatio(fg, accent) ? WHITE : fg,
    accent,
    4.5
  );
  // 主按钮：反过来把**背景**压暗到白字达 AA，保住白字的品牌观感而不是把字改黑
  const accentStrong = walkToward(accent, BLACK, [WHITE], 4.5);

  const textSecondary = adjustToward(muted, fg, surfaces, 4.5);
  const textTertiary = adjustToward(mix(muted, card, dark ? 0.3 : 0.34), fg, surfaces, 3);

  const state = (name: 'success' | 'warning' | 'danger' | 'info') => {
    const base = STATE_BASE[mode][name];
    const tinted = mix(base, fg, 0.12);
    const strong = adjustToward(tinted, ink, surfaces, 4.5);
    const soft = dark ? mix(card, strong, 0.16) : mix(WHITE, strong, 0.12);
    const solid = solidState(base);
    return {
      strong: fmtRgb(strong),
      soft: fmtRgb(soft),
      solid: fmtRgb(solid.bg),
      onSolid: fmtRgb(solid.on),
      solidHover: fmtRgb(solid.hover),
    };
  };
  const s = state('success');
  const w = state('warning');
  const d = state('danger');
  const i = state('info');

  return {
    'surface-0': fmtRgb(bg),
    'surface-1': fmtRgb(card),
    'surface-2': fmtRgb(surface2),
    'surface-3': fmtRgb(surface3),
    'text-primary': fmtRgb(fg),
    'text-secondary': fmtRgb(textSecondary),
    'text-tertiary': fmtRgb(textTertiary),
    'text-inverse': fmtRgb(bg),
    accent: fmtRgb(accent),
    'accent-hover': fmtRgb(accentHover),
    'accent-active': fmtRgb(accentActive),
    'accent-soft': fmtRgb(accentSoft),
    'accent-border': fmtRgb(accent),
    'on-accent': fmtRgb(onAccent),
    'accent-strong': fmtRgb(accentStrong),
    'accent-strong-hover': fmtRgb(mix(accentStrong, BLACK, 0.16)),
    'accent-text': fmtRgb(ensureContrast(accent, surfaces, 4.5)),
    success: s.strong,
    'success-soft': s.soft,
    warning: w.strong,
    'warning-soft': w.soft,
    danger: d.strong,
    'danger-soft': d.soft,
    info: i.strong,
    'info-soft': i.soft,
    'success-solid': s.solid,
    'on-success-solid': s.onSolid,
    'success-solid-hover': s.solidHover,
    'warning-solid': w.solid,
    'on-warning-solid': w.onSolid,
    'warning-solid-hover': w.solidHover,
    'danger-solid': d.solid,
    'on-danger-solid': d.onSolid,
    'danger-solid-hover': d.solidHover,
    'info-solid': i.solid,
    'on-info-solid': i.onSolid,
    'info-solid-hover': i.solidHover,
    border: fmtRgb(border),
    'border-strong': fmtRgb(mix(border, fg, dark ? 0.22 : 0.16)),
    scrim: dark ? '0 0 0 / 0.62' : `${fmtRgb(fg)} / 0.42`,
    overlay: fmtRgb(card),
    focus: fmtRgb(accent),
    // 三档材质：浅色 .74/.88，暗色 .60/.80（暗色透明度更低才看得见极光）
    'glass-1': dark ? `${fmtRgb(card)} / 0.6` : '255 255 255 / 0.74',
    'glass-2': dark ? `${fmtRgb(card)} / 0.8` : '255 255 255 / 0.88',
    'glass-line': dark ? '255 255 255 / 0.1' : `${fmtRgb(fg)} / 0.09`,
  };
}

/** 种子 + 派生 → 完整 CSS 变量表（键带 `--mn-` 前缀，值可直接 setProperty） */
export function buildThemeTokens(def: ThemeDef, mode: Mode): Record<string, string> {
  const seed = def[mode];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(seed)) out[k] = v; // 遗留 7 键原样透传
  for (const [k, v] of Object.entries(deriveTokens(seed, mode))) out[`--mn-${k}`] = v;
  const extra = def.passthrough?.[mode];
  if (extra) Object.assign(out, extra);

  // 主题自带主按钮色（如液态玻璃的 --mn-glass-button）时，以它为基准重算 accent-strong，
  // 但仍由引擎保证白字 AA —— 主题可以决定"用哪个蓝"，不能决定"对比度不够"。
  const own = extra?.['--mn-glass-button'];
  if (own) out['--mn-accent-strong'] = fmtRgb(walkToward(parseRgb(own), BLACK, [WHITE], 4.5));
  return out;
}

/* ------------------------------ 原生端出口（hex） ------------------------------ */

/**
 * `'r g b'` / `'r g b / a'` → `#rrggbb`（带 alpha 时 → `#rrggbbaa`）。
 * RN 与构建脚本只能吃 hex，转换收在这里，避免各端自己拼字符串。
 */
export function toHex(color: RgbString): string {
  // 先按 '/' 切：'255 255 255 / 0.5' 若直接按空白拆，会把 '/' 本身当成一个分量，
  // alpha 于是被算成 0（本模块的测试抓到了这个 bug）。
  const [rgbPart = '', alphaPart] = color.split('/');
  const [r, g, b] = rgbPart.trim().split(/\s+/);
  if (r === undefined || g === undefined || b === undefined) {
    throw new Error(`theme-engine: 无法转 hex 的颜色 '${color}'`);
  }
  const hex = (v: string) => clamp(Number(v), 0, 255).toString(16).padStart(2, '0');
  const base = `#${hex(r)}${hex(g)}${hex(b)}`;
  if (alphaPart === undefined) return base;
  const alpha = Number(alphaPart.trim());
  return Number.isFinite(alpha) && alpha < 1
    ? `${base}${clamp(Math.round(alpha * 255), 0, 255)
        .toString(16)
        .padStart(2, '0')}`
    : base;
}

/** `#rrggbb` / `#rrggbbaa` → 三元组（与 `toHex` 对称，供测试与原生端反查） */
export function parseHex(hex: string): Rgb {
  const h = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) {
    throw new Error(`theme-engine: 无法解析 hex '${hex}'`);
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/**
 * 给 React Native / 构建脚本用的 hex 调色板。
 * RN 没有 CSS 变量，只能把颜色当 JS 常量传；这里保证那份常量**同样来自种子**，
 * 而不是像改造前那样在 `mobile/src/theme.ts` 里再手抄一遍 98 个 hex（ARCH-R01 的一半问题就在这）。
 */
export interface Palette {
  bg: string;
  card: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
  accentSoft: string;
  accentStrong: string;
  accentText: string;
  onAccent: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  surface3: string;
  scrim: string;
}

export function resolvePalette(def: ThemeDef, mode: Mode): Palette {
  const tokens = buildThemeTokens(def, mode);
  const hex = (k: string) => toHex(tokens[k] ?? '');
  return {
    bg: hex('--mn-bg'),
    card: hex('--mn-card'),
    fg: hex('--mn-fg'),
    muted: hex('--mn-fg-muted'),
    border: hex('--mn-border'),
    accent: hex('--mn-accent'),
    accentSoft: hex('--mn-accent-soft'),
    accentStrong: hex('--mn-accent-strong'),
    accentText: hex('--mn-accent-text'),
    onAccent: hex('--mn-on-accent'),
    success: hex('--mn-success'),
    warning: hex('--mn-warning'),
    danger: hex('--mn-danger'),
    info: hex('--mn-info'),
    surface3: hex('--mn-surface-3'),
    scrim: hex('--mn-scrim'),
  };
}
/** 审计：返回该主题该模式下**未达标**的项（空数组即通过） */
export function auditContrast(
  def: ThemeDef,
  mode: Mode
): { key: string; ratio: number; need: number }[] {
  const seed = def[mode];
  const t = deriveTokens(seed, mode);
  const surfaces = [parseRgb(t['surface-0']), parseRgb(t['surface-1']), parseRgb(t['surface-3'])];
  const bad: { key: string; ratio: number; need: number }[] = [];
  const check = (key: keyof DerivedTokens, need: number, on: Rgb[] = surfaces) => {
    const ratio = worstContrast(parseRgb(t[key]), on);
    if (ratio < need) bad.push({ key: key as string, ratio: Math.round(ratio * 100) / 100, need });
  };
  check('text-primary', 4.5);
  check('text-secondary', 4.5);
  check('text-tertiary', 3);
  check('success', 4.5);
  check('warning', 4.5);
  check('danger', 4.5);
  check('info', 4.5);
  check('on-accent', 4.5, [parseRgb(seed['--mn-accent'])]);
  // 强调色当文字用：必须在每一层底色上都达 AA
  check('accent-text', 4.5);
  /*
   * 实心状态底：底与字是一起推导的，所以两个方向都要验——
   * 白字档要容得下白字，墨字档要容得下墨字；hover 档只会更深/更浅，不可能反过来掉档。
   */
  for (const name of ['success', 'warning', 'danger', 'info'] as const) {
    const bg = parseRgb(t[`${name}-solid`]);
    const on = parseRgb(t[`on-${name}-solid`]);
    const hover = parseRgb(t[`${name}-solid-hover`]);
    const ratio = contrastRatio(on, bg);
    if (ratio < 4.5)
      bad.push({
        key: `${name}-solid(text on bg)`,
        ratio: Math.round(ratio * 100) / 100,
        need: 4.5,
      });
    const ratioHover = contrastRatio(on, hover);
    if (ratioHover < 4.5)
      bad.push({
        key: `${name}-solid-hover(text on bg)`,
        ratio: Math.round(ratioHover * 100) / 100,
        need: 4.5,
      });
  }

  // 主按钮底必须容得下白字
  const strongWhite = contrastRatio(WHITE, parseRgb(t['accent-strong']));
  if (strongWhite < 4.5) {
    bad.push({
      key: 'accent-strong(white text)',
      ratio: Math.round(strongWhite * 100) / 100,
      need: 4.5,
    });
  }
  return bad;
}
