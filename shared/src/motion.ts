/**
 * 动效令牌 —— 四端共用的唯一一份时长与曲线（阶段 3 · §3.3）
 *
 * 为什么要放在 TS 里而不是只放 CSS：`--mn-duration-*` 只有 web / 桌面 / 小程序（CSS 侧）
 * 能读，RN 拿不到 CSS 变量，于是它要么各写一套毫秒数、要么根本没有动效。
 * 现在四端都从这一个对象取值：
 *   - CSS 侧：shared/styles/tokens.css 里的字面量必须与此一致，
 *     由 `pnpm ui:check` 断言（改一处忘另一处 = 红）；
 *   - 小程序：scripts/gen-mp-tokens.mjs 把这里渲染成 --motion-* 写进 theme-tokens.scss，
 *     app.scss 不再自己定义时长；
 *   - RN：直接 import MOTION（Animated / LayoutAnimation 都吃毫秒数）。
 *
 * 数值口径来自 docs/ui-optimization.md §3.3：120 / 180 / 240ms + cubic-bezier(.2,0,0,1)。
 * 曲线只有一条：三端各用一条"顺手"的曲线，是端间漂移最隐蔽的一种——同一动作看起来
 * 就是"不太跟手"，但没人能指出差在哪。
 */
export const MOTION = {
  /** 即时反馈：按压、hover、焦点、图标切换 */
  fast: 120,
  /** 默认档：颜色/边框过渡、列表进出、toast 出现 */
  med: 180,
  /** 大位移：抽屉、弹窗、页面转场、材质切换 */
  slow: 240,
  /** 统一曲线（Material "standard" 那一条：快起步、长收尾） */
  ease: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

/** CSS 自定义属性写法，供生成器与文档比对使用 */
export const MOTION_CSS_VARS = {
  '--mn-duration-fast': `${MOTION.fast}ms`,
  '--mn-duration-med': `${MOTION.med}ms`,
  '--mn-duration-slow': `${MOTION.slow}ms`,
  '--mn-ease': MOTION.ease,
} as const;

/** RN 的 spring/timing 配置也归这里，避免各屏自己挑 stiffness */
export const MOTION_SNAP = {
  duration: MOTION.med,
  easing: (t: number): number => 1 - Math.pow(1 - t, 3),
} as const;
