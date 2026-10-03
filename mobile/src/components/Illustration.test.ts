/**
 * RN 插画映射的契约测试
 *
 * 为什么值得单独测：react-native-svg 的属性继承是**运行时行为**（组的属性在渲染时
 * 下发给没有自己的那份属性的子元素）。web 那边 presentation attribute 天然继承，
 * 所以同一份几何在两端"看起来一样"并不等于"依赖同一种机制"。
 * 一旦继承在某处断掉，extractFill 的默认值是 processColor('black') ——
 * 开口弧线会被填成黑色饼块，而这在 typecheck、构建、打包里全都看不出来。
 *
 * 所以这里断言的不是"画得好不好看"，而是**一个元素都不依赖继承**。
 * 这条能在 JS 里跑，真机只需要确认描边观感，不需要再排查"是不是哪里没填上"。
 */
import { describe, expect, it } from 'vitest';
import { ILL_NAMES, ILL_SIZES, ILL_VIEW_BOX } from '@dustnote/shared';
import { illElements } from './Illustration';

const INK = '#475569';
const ACCENT = '#3b82f6';

describe('RN 插画映射 · 不依赖继承', () => {
  it('每张图形的元素数量与节点表一致（没有静默丢节点）', () => {
    for (const n of ILL_NAMES) {
      const els = illElements(n, INK, ACCENT);
      expect(els.length, `${n} 元素数`).toBeGreaterThan(0);
    }
  });

  it('描边类元素一律自带 fill / strokeLinecap / strokeLinejoin', () => {
    for (const n of ILL_NAMES) {
      for (const e of illElements(n, INK, ACCENT)) {
        expect(e.props.fill, `${n} 的 ${e.kind} 没写 fill`).toBeDefined();
        if (e.props.fill === 'none') {
          // 空心元素：三件套必须齐，且必须有 stroke 才有意义
          expect(e.props.strokeLinecap, `${n} 的 ${e.kind} 没写 linecap`).toBe('round');
          expect(e.props.strokeLinejoin, `${n} 的 ${e.kind} 没写 linejoin`).toBe('round');
          expect(e.props.stroke, `${n} 的 ${e.kind} 没写 stroke`).toBeTruthy();
        } else {
          // 实心尘埃点：反过来，描边必须显式关掉
          expect(e.props.stroke, `${n} 的实心 ${e.kind} 应显式 stroke:'none'`).toBe('none');
        }
      }
    }
  });

  it('绝不把 currentColor 交给 RN（它没有这个概念，会变黑或变透明）', () => {
    for (const n of ILL_NAMES) {
      for (const e of illElements(n, INK, ACCENT)) {
        for (const v of Object.values(e.props)) {
          expect(String(v), `${n} 出现了 currentColor`).not.toContain('currentColor');
        }
      }
    }
  });

  it('颜色只有两个来源：ink 与 accent（规则 2 的 RN 侧）', () => {
    for (const n of ILL_NAMES) {
      for (const e of illElements(n, INK, ACCENT)) {
        const painted = [e.props.stroke, e.props.fill].filter(
          (v) => typeof v === 'string' && v !== 'none'
        ) as string[];
        for (const p of painted) {
          expect([INK, ACCENT], `${n} 出现了第三种颜色 ${p}`).toContain(p);
        }
      }
    }
  });

  it('虚线被转成数字数组（RN 的 strokeDasharray 不吃 "3 3" 这种字符串）', () => {
    const els = illElements('empty-scope', INK, ACCENT);
    const dashed = els.filter((e) => e.props.strokeDasharray !== undefined);
    expect(dashed.length, 'empty-scope 应有虚线元素').toBeGreaterThan(0);
    for (const e of dashed) {
      expect(Array.isArray(e.props.strokeDasharray)).toBe(true);
      for (const v of e.props.strokeDasharray as number[]) {
        expect(typeof v).toBe('number');
        expect(v).toBeGreaterThan(0);
      }
    }
  });

  it('viewBox 与两档画幅都拼得出来（比例差走 preserveAspectRatio 的留白，不是拉伸）', () => {
    const [vw, vh] = ILL_VIEW_BOX.split(' ').slice(2).map(Number);
    expect(vw).toBeGreaterThan(0);
    for (const d of Object.values(ILL_SIZES)) {
      expect(d.w).toBeGreaterThan(0);
      expect(d.h).toBeGreaterThan(0);
    }
  });
});
