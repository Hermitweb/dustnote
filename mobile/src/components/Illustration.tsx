/**
 * RN 插画（react-native-svg）
 *
 * 几何来自 shared/src/illustrations.ts —— 与 web / 小程序同一份节点表。
 * 着色只有两个角色（规则 2）：ink 跟随传入的主题前景，accent 用主题强调色。
 * 节点表里没有颜色字段，所以这里拿不到任何硬写色值 —— 它只能从 useColors() 来。
 *
 * 注意：react-native-svg 此前虽在依赖里，但全仓没有一处运行时使用。
 * 本文件是第一处，因此需要一次真机确认（Android / iOS 的 SVG 描边由原生渲染，
 * 与浏览器的 stroke-linejoin 细节可能有 1px 级差异）。
 */
import { Circle, Path, Rect, Svg } from 'react-native-svg';
import {
  ILLUSTRATIONS,
  ILL_SIZES,
  ILL_STROKE,
  ILL_VIEW_BOX,
  type IllName,
  type IllNode,
  type IllSize,
} from '@dustnote/shared';
import { useColors } from '../theme';

export interface IllustrationProps {
  name: IllName;
  size?: IllSize;
  /** 覆盖 ink 色（例如错误屏传 danger）；不传则用主题的次级前景 */
  color?: string;
}

function renderNode(n: IllNode, key: number, ink: string, accent: string) {
  const stroke = n.c === 'accent' ? accent : ink;
  const w = n.w ?? ILL_STROKE;
  const o = n.o ?? 1;
  const dash = 'dash' in n && n.dash ? n.dash.split(' ').map(Number) : undefined;
  switch (n.k) {
    case 'p':
      return (
        <Path
          key={key}
          d={n.d}
          stroke={stroke}
          strokeOpacity={o}
          strokeWidth={w}
          strokeDasharray={dash}
        />
      );
    case 'l':
      return (
        <Path
          key={key}
          d={`M${n.x1} ${n.y1}L${n.x2} ${n.y2}`}
          stroke={stroke}
          strokeOpacity={o}
          strokeWidth={w}
          strokeDasharray={dash}
        />
      );
    case 'r':
      return (
        <Rect
          key={key}
          x={n.x}
          y={n.y}
          width={n.w}
          height={n.h}
          rx={n.rx ?? 0}
          stroke={stroke}
          strokeOpacity={o}
          strokeWidth={ILL_STROKE}
          strokeDasharray={dash}
          fill="none"
        />
      );
    case 'c':
      if (n.f)
        return <Circle key={key} cx={n.cx} cy={n.cy} r={n.r} fill={stroke} fillOpacity={o} />;
      return (
        <Circle
          key={key}
          cx={n.cx}
          cy={n.cy}
          r={n.r}
          stroke={stroke}
          strokeOpacity={o}
          strokeWidth={w}
          strokeDasharray={dash}
          fill="none"
        />
      );
  }
}

export function Illustration({ name, size = 'plate', color }: IllustrationProps) {
  const c = useColors();
  const d = ILL_SIZES[size];
  const ink = color ?? c.muted;
  const vb = ILL_VIEW_BOX.split(' ').slice(2).map(Number);
  return (
    <Svg
      width={d.w}
      height={d.h}
      viewBox={`0 0 ${vb[0]} ${vb[1]}`}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      accessible={false}
    >
      {ILLUSTRATIONS[name].map((n, i) => renderNode(n, i, ink, c.accent))}
    </Svg>
  );
}

export default Illustration;
