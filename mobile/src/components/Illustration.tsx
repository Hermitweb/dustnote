/**
 * RN 插画（react-native-svg）
 *
 * 几何来自 shared/src/illustrations.ts —— 与 web / 小程序同一份节点表。
 *
 * 为什么每个元素都显式写 fill / strokeLinecap / strokeLinejoin，而不是在 <Svg> 上写一次：
 * react-native-svg 的根节点会把描边属性转交给一个内部 <G>，再由 G 在渲染时
 * "下发"给子元素（Android RenderableView.mergeProperties、iOS RNSVGGroup 的
 * mergeProperties，两边都只在子元素自己没有该属性时才覆盖）。
 * 这套继承在两个平台上都成立，但它是**运行时行为**：一旦某处不成立，
 * 开口弧线（error 的信号弧就是开口的）会被默认填成黑色饼块 —— 而 fill 的默认值
 * 在 extractFill 里明确写着 processColor('black')。
 * 与其信继承，不如不依赖它：显式写三行，代价是零，换来的是"两个渲染器行为一致"
 * 这件事可以在 JS 里用测试证明，而不是等真机。
 *
 * 顺带：这里绝不出现 'currentColor' —— RN 没有这个概念，颜色必须由 useColors() 解析成
 * 具体 hex 再传下去。
 */
import { Circle, G, Path, Rect, Svg } from 'react-native-svg';
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

/** 与 web 的 Illustration.tsx 同一套映射；改一处要改两处，所以在这里注明 */
export interface IllElement {
  kind: 'path' | 'rect' | 'circle';
  props: Record<string, unknown>;
}

/** 每个元素都自带的三属性：不依赖任何继承 */
const PEN = {
  fill: 'none',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function illElements(name: IllName, ink: string, accent: string): IllElement[] {
  return (ILLUSTRATIONS[name] as readonly IllNode[]).map((n) => {
    const stroke = n.c === 'accent' ? accent : ink;
    const strokeWidth = n.w ?? ILL_STROKE;
    const strokeOpacity = n.o ?? 1;
    const strokeDasharray = 'dash' in n && n.dash ? n.dash.split(' ').map(Number) : undefined;
    switch (n.k) {
      case 'p':
        return {
          kind: 'path',
          props: { d: n.d, stroke, strokeWidth, strokeOpacity, strokeDasharray, ...PEN },
        };
      case 'l':
        return {
          kind: 'path',
          props: {
            d: `M${n.x1} ${n.y1}L${n.x2} ${n.y2}`,
            stroke,
            strokeWidth,
            strokeOpacity,
            strokeDasharray,
            ...PEN,
          },
        };
      case 'r':
        return {
          kind: 'rect',
          props: {
            x: n.x,
            y: n.y,
            width: n.w,
            height: n.h,
            rx: n.rx ?? 0,
            stroke,
            strokeWidth: ILL_STROKE,
            strokeOpacity,
            strokeDasharray,
            ...PEN,
          },
        };
      case 'c':
        return n.f
          ? {
              kind: 'circle',
              /* 尘埃点是实心的：它没有内部结构，描一圈反而糊。
                 这里 fill 有值、stroke 显式 none，同样不靠继承 */
              props: {
                cx: n.cx,
                cy: n.cy,
                r: n.r,
                fill: stroke,
                fillOpacity: strokeOpacity,
                stroke: 'none',
              },
            }
          : {
              kind: 'circle',
              props: {
                cx: n.cx,
                cy: n.cy,
                r: n.r,
                stroke,
                strokeWidth,
                strokeOpacity,
                strokeDasharray,
                ...PEN,
              },
            };
    }
  });
}

export interface IllustrationProps {
  name: IllName;
  size?: IllSize;
  /** 覆盖 ink 色（例如错误屏传 danger）；不传则用主题的次级前景 */
  color?: string;
}

export function Illustration({ name, size = 'plate', color }: IllustrationProps) {
  const c = useColors();
  const d = ILL_SIZES[size];
  const [vw, vh] = ILL_VIEW_BOX.split(' ').slice(2).map(Number);
  const els = illElements(name, color ?? c.muted, c.accent);
  return (
    <Svg
      width={d.w}
      height={d.h}
      viewBox={`0 0 ${vw} ${vh}`}
      /* preserveAspectRatio 与 web 的 SVG 默认值一致（xMidYMid meet），
         所以两档画幅差那 0.8% 只会变成留白，不会变成拉伸 */
      accessible={false}
    >
      <G>
        {els.map((e, i) =>
          e.kind === 'path' ? (
            <Path key={i} {...e.props} />
          ) : e.kind === 'rect' ? (
            <Rect key={i} {...e.props} />
          ) : (
            <Circle key={i} {...e.props} />
          )
        )}
      </G>
    </Svg>
  );
}

export default Illustration;
