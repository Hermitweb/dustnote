/**
 * react-native-svg 桩。
 *
 * 为什么要桩它：真包是原生模块 + Flow/TS 源码，vitest（node 环境）直接 import 会
 * "Unexpected token 'typeof'"。mobile 的测试策略本来就是**只 mock 平台 I/O 边界**，
 * react-native-svg 正属于这一类（它把 JS 元素交给 Android/iOS 的原画布）。
 *
 * 桩保留元素名与 props 透传，因此组件测试可以断言"生成了什么元素、带什么属性"；
 * 但它**不还原任何渲染语义** —— 描边、填充、继承的真实效果只能在真机上看。
 * 这条边界写在这里，是为了不让"测试全绿"被误读成"画面对了"。
 */
import type { ReactNode } from 'react';

export interface StubElement {
  type: string;
  props: Record<string, unknown>;
  children: ReactNode;
}

function stub(type: string) {
  return function Stub(props: Record<string, unknown> & { children?: ReactNode }): StubElement {
    const { children, ...rest } = props;
    return { type, props: rest, children };
  };
}

export const Svg = stub('Svg');
export const G = stub('G');
export const Path = stub('Path');
export const Rect = stub('Rect');
export const Circle = stub('Circle');
export const Line = stub('Line');
export const Defs = stub('Defs');
export const ClipPath = stub('ClipPath');

export default Svg;
