/**
 * 插画语言 —— 三端共用的唯一一份几何
 *
 * 为什么存成数据而不是 SVG 字符串：三条渲染链路要吃的东西不一样
 *   web     -> React <path>/<circle>（currentColor 继承文字色）
 *   小程序  -> 构建期生成 mask data-URI（与 gen-mp-icons.mjs 同一条路）
 *   RN      -> react-native-svg 的 <Path>/<Circle>
 * 存字符串就得为每端各写一份解析；存结构化节点，三端各自映射到自己会的原语。
 *
 * 八条规则里最要紧的两条，靠这个文件的结构来保证：
 *   1) **没有颜色字段**。节点只能声明 c:'ink' | 'accent'，具体色值由渲染端给
 *      （ink = currentColor，于是自动跟随 tone 与明暗；accent = 强调色）。
 *      所以本文件里出现任何 hex / rgb() 都是错的，pnpm ui:check 有这条断言。
 *   2) **只有一套笔**。默认 stroke-width 1.5、圆头圆角、fill:none——
 *      与 lucide 图标同一支笔，插画和图标并排时不会像"贴了张别人的图"。
 *
 * 画幅只有两档，且与 StatePlate 的 plate / card 一一对应：
 *   plate 88x64、card 120x88（同一 viewBox 等比放大，几何只有一份）
 *
 * 落地集是 5 张（提案 6 张，loading 撤了，理由见文件末尾）。
 * 图版原本是 44x44 / 56x56 的方框，插画塞进去会退化成一个图标 —— 所以这两档
 * 是"扩过的"，见 docs/ui-optimization.md §3.6.3 与 docs/mockups/illustration-language.html。
 */

/** 画布坐标系：所有插画共用，渲染端按 ILL_SIZES 缩放 */
export const ILL_VIEW_BOX = '0 0 88 64';

/** 与 lucide 同一支笔 */
export const ILL_STROKE = 1.5;

/** 两档画幅（宽 × 高，CSS px / 设计 px） */
export const ILL_SIZES = {
  plate: { w: 88, h: 64 },
  card: { w: 120, h: 88 },
} as const;

export type IllSize = keyof typeof ILL_SIZES;

/** 着色只有两个角色，没有第三种：这是"不引入新色相"那条规则的实现 */
export type IllColor = 'ink' | 'accent';

/**
 * 节点原语。`o` 是不透明度（0-1）；`f` 表示实心（只有尘埃点用）；
 * `dash` 是虚线模式——空态用它表示"这里本该有东西"，见规则 5。
 */
export type IllNode =
  | { k: 'p'; d: string; o?: number; c?: IllColor; w?: number; dash?: string }
  | {
      k: 'c';
      cx: number;
      cy: number;
      r: number;
      o?: number;
      c?: IllColor;
      w?: number;
      f?: boolean;
      dash?: string;
    }
  | {
      k: 'r';
      x: number;
      y: number;
      w: number;
      h: number;
      rx?: number;
      o?: number;
      c?: IllColor;
      dash?: string;
    }
  | {
      k: 'l';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      o?: number;
      c?: IllColor;
      w?: number;
    };

/** 地平线：主体坐在一条淡横线上，没有它东西在飘（规则 4） */
const GROUND: IllNode[] = [{ k: 'l', x1: 13, y1: 53.5, x2: 75, y2: 53.5, o: 0.14 }];

/** 断裂的地平线：错误态专用（规则 5 的"不连续=出错"） */
const GROUND_BROKEN: IllNode[] = [
  { k: 'l', x1: 13, y1: 53.5, x2: 37, y2: 53.5, o: 0.14 },
  { k: 'l', x1: 51, y1: 53.5, x2: 75, y2: 53.5, o: 0.14 },
];

/** 尘埃母题：2-3 颗渐淡圆点，六个状态唯一共有的元素（规则 3） */
const dust = (cx: number, cy: number, r: number, o: number): IllNode => ({
  k: 'c',
  cx,
  cy,
  r,
  o,
  f: true,
});

export const ILLUSTRATIONS = {
  /** 第一次用：翻开的本子 + 唯一一处 accent 落在"加号"上（那个能做的动作） */
  'first-use': [
    { k: 'p', d: 'M44 19C38.5 14.6 28.6 14.1 22 17.6V45.6C28.6 42.1 38.5 42.6 44 47Z', o: 0.55 },
    { k: 'p', d: 'M44 19C49.5 14.6 59.4 14.1 66 17.6V45.6C59.4 42.1 49.5 42.6 44 47Z', o: 0.55 },
    { k: 'p', d: 'M44 19V47', o: 0.38 },
    { k: 'p', d: 'M70 8.5V20.5M64 14.5H76', c: 'accent', w: 1.75 },
    dust(13.5, 12, 1.6, 0.3),
    dust(21, 6.5, 1.05, 0.2),
    dust(8, 21.5, 1.05, 0.15),
    ...GROUND,
  ],
  /** 这个范围是空的：一张虚线卡片正被放进文件夹 */
  'empty-scope': [
    {
      k: 'p',
      d: 'M14 21a2 2 0 0 1 2-2h15l4 5h33a2 2 0 0 1 2 2v21a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2Z',
      o: 0.5,
    },
    { k: 'r', x: 32, y: 8.5, w: 24, h: 14, rx: 2, o: 0.34, dash: '3 3' },
    { k: 'p', d: 'M44 25v7M40.8 29l3.2 3.2 3.2-3.2', c: 'accent', w: 1.75 },
    dust(16, 12, 1.3, 0.24),
    dust(73, 16, 1.05, 0.18),
    ...GROUND,
  ],
  /** 搜了没有：放大镜里是一个虚线空圆 */
  'no-results': [
    { k: 'c', cx: 37, cy: 27, r: 13, o: 0.55 },
    { k: 'c', cx: 37, cy: 27, r: 6, o: 0.32, dash: '2 3' },
    { k: 'p', d: 'M46.6 36.6 57.4 47.4', o: 0.55, w: 2 },
    { k: 'p', d: 'M63.5 10l6.5 6.5M70 10l-6.5 6.5', c: 'accent', w: 1.75 },
    dust(18, 10, 1.3, 0.24),
    dust(27, 6, 1, 0.17),
    ...GROUND,
  ],
  /** 回收站 / 收藏为空：笔墨最少的一张（规则 6） */
  plain: [
    { k: 'r', x: 31, y: 37.5, w: 26, h: 15, rx: 2.5, o: 0.42, dash: '3 3' },
    dust(44, 45, 1.7, 0.4),
    dust(30, 20, 1.2, 0.2),
    dust(59, 14, 1.5, 0.26),
    ...GROUND,
  ],
  /** 连接失败 / 崩溃：信号弧从中间断开、地平线也断成两截 */
  error: [
    { k: 'p', d: 'M17 33a19 19 0 0 1 17-13', o: 0.42 },
    { k: 'p', d: 'M23.5 39.5a11.5 11.5 0 0 1 10-6.5', o: 0.3 },
    { k: 'p', d: 'M71 33a19 19 0 0 0-17-13', o: 0.42 },
    { k: 'p', d: 'M64.5 39.5a11.5 11.5 0 0 0-10-6.5', o: 0.3 },
    { k: 'p', d: 'M40.5 15.5l3 4M47.5 15.5l-3 4', o: 0.5 },
    { k: 'p', d: 'M44 35.5 52.5 50h-17Z', o: 0.62 },
    { k: 'p', d: 'M44 40.5v4.2', o: 0.62 },
    { k: 'c', cx: 44, cy: 47.8, r: 1, o: 0.62, f: true },
    dust(12, 14, 1.3, 0.26),
    dust(76, 18, 1.15, 0.2),
    ...GROUND_BROKEN,
  ],
  /*
   * 提案里的第 6 张 loading 没有落地，理由是诚实的：静态插画当不了忙指示器，
   * 而三端本来就共用一个 spinner（见 shared/src/motion.ts 与 .state-plate-spinner）。
   * 要让弧线真的转起来，web 要 transform-box、小程序的 mask 图根本不能动、
   * RN 要 Animated —— 一套装饰换来三端各一份动画代码，不值。
   * 想加回来时这段注释就是起点。
   */
} as const satisfies Record<string, IllNode[]>;

export type IllName = keyof typeof ILLUSTRATIONS;

export const ILL_NAMES = Object.keys(ILLUSTRATIONS) as IllName[];
