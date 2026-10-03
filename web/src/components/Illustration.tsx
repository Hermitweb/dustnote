/**
 * 插画渲染（web / desktop）
 *
 * 几何来自 shared/src/illustrations.ts —— 三端唯一一份。这里只负责把它映射成
 * React SVG 原语，并且**只映射两个着色角色**：
 *   ink    -> currentColor  自动跟随所在元素的文字色（于是 tone 一变它就变，明暗也变）
 *   accent -> var(--mn-accent)  全站唯一那一处强调
 * 没有第三个角色，所以"不引入新色相"这条规则不是靠自觉，是靠这里没有入口。
 *
 * 尺寸只有两档（plate / card），数值也来自共享表：改画幅只需要改一处，三端跟着动。
 */
import {
  ILLUSTRATIONS,
  ILL_SIZES,
  ILL_STROKE,
  ILL_VIEW_BOX,
  type IllName,
  type IllNode,
} from '@dustnote/shared';

/** 两个角色 -> 两个 CSS 颜色表达式；其余一律不存在 */
const PAINT = { ink: 'currentColor', accent: 'var(--mn-accent)' } as const;

function renderNode(n: IllNode, i: number) {
  const stroke = PAINT[n.c ?? 'ink'];
  const common = {
    stroke,
    strokeOpacity: n.o ?? 1,
    strokeWidth: n.w ?? ILL_STROKE,
    strokeDasharray: 'dash' in n ? n.dash : undefined,
    fill: 'none' as const,
  };
  switch (n.k) {
    case 'p':
      return <path key={i} d={n.d} {...common} />;
    case 'l':
      return <line key={i} x1={n.x1} y1={n.y1} x2={n.x2} y2={n.y2} {...common} />;
    case 'r':
      return <rect key={i} x={n.x} y={n.y} width={n.w} height={n.h} rx={n.rx ?? 0} {...common} />;
    case 'c':
      // 尘埃点是实心的：它没有内部结构，描一圈反而糊
      if (n.f)
        return (
          <circle
            key={i}
            cx={n.cx}
            cy={n.cy}
            r={n.r}
            fill={stroke}
            fillOpacity={n.o ?? 1}
            stroke="none"
          />
        );
      return <circle key={i} cx={n.cx} cy={n.cy} r={n.r} {...common} />;
  }
}

export interface IllustrationProps {
  name: IllName;
  /** 与 StatePlate 同档：plate=88x64、card=120x88 */
  size?: keyof typeof ILL_SIZES;
  className?: string;
}

/**
 * 装饰件：一律 aria-hidden。语义由标题与提示文字承担，
 * 屏幕阅读器不该因为一张画多听一句话（规则 8）。
 */
export function Illustration({ name, size = 'plate', className }: IllustrationProps) {
  const d = ILL_SIZES[size];
  return (
    <svg
      viewBox={ILL_VIEW_BOX}
      width={d.w}
      height={d.h}
      className={className}
      aria-hidden="true"
      focusable="false"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
    >
      {ILLUSTRATIONS[name].map(renderNode)}
    </svg>
  );
}

export default Illustration;
