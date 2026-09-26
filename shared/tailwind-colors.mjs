/**
 * Tailwind 语义色表（web 与 desktop 共用；desktop 复用 web 组件，两边必须一致）
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

export const SEMANTIC_EXTRAS = {
  maxWidth: {
    measure: 'var(--mn-measure, 68ch)',
  },
  borderRadius: {
    sm: 'var(--mn-radius-sm, 6px)',
    md: 'var(--mn-radius-md, 10px)',
    lg: 'var(--mn-radius-lg, 14px)',
    xl: 'var(--mn-radius-xl, 20px)',
  },
  transitionDuration: {
    250: '250ms',
    fast: 'var(--mn-duration-fast, 120ms)',
    med: 'var(--mn-duration-med, 180ms)',
    slow: 'var(--mn-duration-slow, 240ms)',
  },
  transitionTimingFunction: {
    standard: 'var(--mn-ease, cubic-bezier(0.2, 0, 0, 1))',
  },
};
