/**
 * Tailwind 语义色表与尺度表（web 与 desktop 共用；desktop 复用 web 组件，两边必须一致）
 *
 * 为什么单独成文件：改造前 web 与 desktop 各有一份 `tailwind.config.js`，
 * 里面各自硬编码 mint 绿（`#16a34a` 等），而运行时颜色其实来自 CSS 变量 ——
 * 于是"配置里一套绿、界面上另一套主题色"，且 desktop 与 web 还会漂。
 * 值全部指向 `--mn-*`，由 `@dustnote/shared/theme-engine` 在运行时写入，
 * 所以这里**不出现任何具体色值**。
 *
 * 用 .mjs 而不是从 `@dustnote/shared` 入口导入：Tailwind 配置由 jiti 加载，
 * 走包解析会牵连 crypto/i18n 等运行时依赖，相对路径直取最稳。
 */
const rgb = (name) => `rgb(var(--mn-${name}) / <alpha-value>)`;

export const SEMANTIC_COLORS = {
  surface: {
    0: rgb('surface-0'),
    1: rgb('surface-1'),
    2: rgb('surface-2'),
    3: rgb('surface-3'),
    // 兼容既有类名：bg-surface-bg / bg-surface-card / border-surface-border / text-surface-fg|muted
    bg: rgb('bg'),
    card: rgb('card'),
    border: rgb('border'),
    fg: rgb('fg'),
    muted: rgb('fg-muted'),
  },
  text: {
    DEFAULT: rgb('text-primary'),
    primary: rgb('text-primary'),
    secondary: rgb('text-secondary'),
    tertiary: rgb('text-tertiary'),
    inverse: rgb('text-inverse'),
    muted: rgb('fg-muted'),
  },
  accent: {
    DEFAULT: rgb('accent'),
    hover: rgb('accent-hover'),
    active: rgb('accent-active'),
    soft: rgb('accent-soft'),
    strong: rgb('accent-strong'),
    'strong-hover': rgb('accent-strong-hover'),
    text: rgb('accent-text'),
    on: rgb('on-accent'),
  },
  line: {
    DEFAULT: rgb('border'),
    strong: rgb('border-strong'),
  },
  /**
   * 状态色用**扁平名**：text-danger / bg-danger-soft / text-warning ...
   *
   * 原来这些嵌在 state 之下（类名会是 text-state-danger），而全仓写的是扁平名 ——
   * 于是 11 处危险/警告色样式其实是哑的（Tailwind 生成不出规则，元素继承父色），
   * 同时 state-* 一次都没人用。两边都不动就等于把 bug 留在原地，所以拉平到实际写法。
   * 值仍指向 --mn-*：状态色由引擎按承载面（含玻璃面板）算到 AA。
   */
  success: rgb('success'),
  'success-soft': rgb('success-soft'),
  warning: rgb('warning'),
  'warning-soft': rgb('warning-soft'),
  danger: rgb('danger'),
  'danger-soft': rgb('danger-soft'),
  info: rgb('info'),
  'info-soft': rgb('info-soft'),
  /* 实心状态底 + 与之配对的文字色（toast / 危险按钮 / 状态徽标） */
  'success-solid': rgb('success-solid'),
  'on-success-solid': rgb('on-success-solid'),
  'success-solid-hover': rgb('success-solid-hover'),
  'warning-solid': rgb('warning-solid'),
  'on-warning-solid': rgb('on-warning-solid'),
  'warning-solid-hover': rgb('warning-solid-hover'),
  'danger-solid': rgb('danger-solid'),
  'on-danger-solid': rgb('on-danger-solid'),
  'danger-solid-hover': rgb('danger-solid-hover'),
  'info-solid': rgb('info-solid'),
  'on-info-solid': rgb('on-info-solid'),
  'info-solid-hover': rgb('info-solid-hover'),
};

/* ============================ 尺度表（阶段 3 · §3.3 / §3.5） ============================
 *
 * 字号与间距为什么必须在 Tailwind 侧接线：`applyTypography()` 一直在写 `--mn-text-base`
 * 与 `--mn-space-scale`，可类名从来没读它们——`text-xs` 走 Tailwind 内置 12px、`p-3` 走
 * 内置 12px。于是设置里的"密度"实际只有行高在动，字号与间距是假的。一个看起来能调、
 * 调了什么都没变的开关，比没有这个开关更糟。
 *
 * 阶梯值取自**改造前的实际渲染尺寸**（xs=12 / sm=14 / base=16 …），所以 `--mn-density: 1`
 * 时逐像素不变：打磨不该顺带改掉已经定稿的视觉。行高写成无单位倍数（16/12=1.3334 等），
 * 数值上等价于今天的绝对行高，但它会跟着字号缩放，不会在放大密度时停在旧像素上撑破行盒。
 */
const TEXT = (step) => `var(--mn-text-${step})`;
// 全精度比值：四舍五入到 4 位（1.3333）会让 12px 的行高变成 15.9996px，
// 在 2x 屏上足以把整段文字挪动一个设备像素——截图对不上，白白多出一处"改动"。
const leading = (px, size) => String(px / size);

const fontSizeScale = {
  /* 2xs 刻意不带第二项：它替代的是原先的 text-[11px]，那条从来不信行高，继承父级 */
  '2xs': [TEXT('2xs')],
  xs: [TEXT('xs'), { lineHeight: leading(16, 12) }],
  sm: [TEXT('sm'), { lineHeight: leading(20, 14) }],
  base: [TEXT('base'), { lineHeight: leading(24, 16) }],
  lg: [TEXT('lg'), { lineHeight: leading(28, 18) }],
  xl: [TEXT('xl'), { lineHeight: leading(28, 20) }],
  '2xl': [TEXT('2xl'), { lineHeight: leading(32, 24) }],
  '3xl': [TEXT('3xl'), { lineHeight: leading(36, 30) }],
  '4xl': [TEXT('4xl'), { lineHeight: leading(40, 36) }],
  '5xl': [TEXT('5xl'), { lineHeight: '1' }],
};

/**
 * 间距阶梯：与 Tailwind 内置同名同值（0.25rem 步进），只多乘一个 --mn-density。
 * `0` 与 `px` 不参与缩放——发丝线与该为 0 的地方不该跟着密度漂。
 */
const SPACING_STEPS = [
  '0.5',
  '1',
  '1.5',
  '2',
  '2.5',
  '3',
  '3.5',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '14',
  '16',
  '20',
  '24',
  '28',
  '32',
  '36',
  '40',
  '44',
  '48',
  '52',
  '56',
  '60',
  '64',
  '72',
  '80',
  '96',
];
const spacingScale = { 0: '0', px: '1px' };
for (const step of SPACING_STEPS) {
  spacingScale[step] = `calc(${Number(step) * 0.25}rem * var(--mn-density, 1))`;
}

export const SEMANTIC_EXTRAS = {
  maxWidth: {
    measure: 'var(--mn-measure, 68ch)',
  },
  fontSize: fontSizeScale,
  spacing: spacingScale,
  borderRadius: {
    sm: 'var(--mn-radius-sm, 6px)',
    md: 'var(--mn-radius-md, 10px)',
    lg: 'var(--mn-radius-lg, 14px)',
    xl: 'var(--mn-radius-xl, 20px)',
  },
  /**
   * 层级只在这一处定义。此前 z-10/20/30/40/50 与 12 处 `z-[60]/[70]/[90]/[9999]` 并存，
   * 弹层谁压谁全靠记忆，加一个浮层就要猜一次数字。命名按角色而非数字，读代码时
   * `z-dialog` 比 `z-[60]` 直接讲清"它压在抽屉之上、被 toast 盖住"。
   */
  /**
   * 层级阶梯只在这里定义。此前 12 处写的是 z-[60] / z-[61] / z-[70] / z-[9999] 这种
   * 无界数字——加一个浮层就得现场猜一个数，谁压谁全靠记忆，且 `z-[...]` 是 Tailwind
   * 唯一能绕过审查的口子（类名扫不出问题）。这里给一张有限的梯子并封顶到 z-system；
   * 数值与改造前逐一对齐（60 仍是"确认弹窗"层），所以不引入任何压叠顺序的变化。
   */
  zIndex: {
    base: '0',
    raised: '10',
    sticky: '20',
    header: '30',
    drawer: '40',
    overlay: '50',
    confirm: '60',
    nested: '70',
    stacked: '90',
    toast: '100',
    system: '10000',
  },
  /**
   * `DEFAULT` 是这一节的关键：组件写 `transition-colors` 时通常不填时长，此前一律
   * 吃掉 Tailwind 内置 150ms——79 处 transition 没有一处在用令牌档位。DEFAULT 指向
   * 令牌后，不写时长也走统一节奏；显式写了的照旧生效。
   * 原来这里还有个 `250: '250ms'` 字面档位，删掉：尺度外的野档位留着就有人会去用。
   */
  transitionDuration: {
    DEFAULT: 'var(--mn-duration-med, 180ms)',
    fast: 'var(--mn-duration-fast, 120ms)',
    med: 'var(--mn-duration-med, 180ms)',
    slow: 'var(--mn-duration-slow, 240ms)',
  },
  transitionTimingFunction: {
    DEFAULT: 'var(--mn-ease, cubic-bezier(0.2, 0, 0, 1))',
    standard: 'var(--mn-ease, cubic-bezier(0.2, 0, 0, 1))',
  },
};
