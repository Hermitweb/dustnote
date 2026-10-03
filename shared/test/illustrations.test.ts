/**
 * 插画语言的契约测试
 *
 * 存在的理由不是覆盖率（虽然它顺带补上了 shared 的 75% 门禁）：
 * 几何从"手画 SVG"改成"结构化节点表"之后，八条规则里有几条变成了**可以机器检查的性质**。
 * 不检查，它们就只是文档里的一句话——而文档里"我们已经统一了"这类话，
 * 这个仓库已经抓到过好几次是反话。
 */
import { describe, expect, it } from 'vitest';
import {
  ILLUSTRATIONS,
  ILL_NAMES,
  ILL_SIZES,
  ILL_STROKE,
  ILL_VIEW_BOX,
  type IllNode,
} from '../src/illustrations';

type AnyNode = IllNode & Record<string, unknown>;

const nodes = (name: (typeof ILL_NAMES)[number]) => ILLUSTRATIONS[name] as unknown as AnyNode[];

describe('插画语言 · 结构契约', () => {
  it('节点类型只有 p / c / r / l 四种（渲染端各自映射这四种，多一种就有一端静默少画）', () => {
    for (const n of ILL_NAMES) {
      for (const node of nodes(n)) {
        expect(['p', 'c', 'r', 'l']).toContain(node.k);
      }
    }
  });

  it('规则 2：一张插画至多一处强调，其余全是中性墨', () => {
    for (const n of ILL_NAMES) {
      const acc = nodes(n).filter((x) => x.c === 'accent');
      expect(acc.length, `${n} 的 accent 节点数`).toBeLessThanOrEqual(1);
    }
  });

  it('规则 2 的另一半：节点表里不许出现任何颜色字面量', () => {
    for (const n of ILL_NAMES) {
      for (const node of nodes(n)) {
        for (const [k, v] of Object.entries(node)) {
          if (typeof v !== 'string') continue;
          expect(v, `${n}.${k} 出现了颜色字面量：${v}`).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/);
        }
      }
    }
  });

  it('规则 4：每张都有一条地平线（没有它，东西在飘）', () => {
    for (const n of ILL_NAMES) {
      const ground = nodes(n).filter((x) => x.k === 'l');
      expect(ground.length, `${n} 缺少地平线`).toBeGreaterThanOrEqual(1);
      for (const g of ground) {
        expect(g.y1).toBe(g.y2); // 地平线是水平的
        expect(g.o, `${n} 的地平线不该抢正文`).toBeLessThanOrEqual(0.2);
      }
    }
  });

  it('不透明度都在 0..1，描边不细于共享值（细则在线稿上会断）', () => {
    for (const n of ILL_NAMES) {
      for (const node of nodes(n)) {
        if (node.o !== undefined) {
          expect(node.o).toBeGreaterThan(0);
          expect(node.o).toBeLessThanOrEqual(1);
        }
        if (node.w !== undefined) expect(node.w).toBeGreaterThanOrEqual(ILL_STROKE);
      }
    }
  });

  it('规则 5：只有空态用虚线（虚线="这里本该有东西"，错误态用断裂而不是虚线）', () => {
    const dashed = ['empty-scope', 'no-results', 'plain'];
    for (const n of ILL_NAMES) {
      const hasDash = nodes(n).some((x) => typeof x.dash === 'string' && x.dash.length);
      expect(hasDash, `${n} 的虚线用法`).toBe(dashed.includes(n));
    }
    // error 用"断开的线"表达断裂：地平线必须是两段
    const errLines = nodes('error').filter((x) => x.k === 'l');
    expect(errLines.length).toBe(2);
  });

  it('规则 6：空得越正常，笔墨越少 —— plain 必须是节点最少的一张', () => {
    const count = Object.fromEntries(ILL_NAMES.map((n) => [n, nodes(n).length]));
    expect(count.plain, 'plain 再薄就成图标了').toBeGreaterThanOrEqual(5);
    expect(count.error, '错误态最重（要拦住人）').toBeGreaterThan(count.plain);
    expect(count['first-use'], 'first-use 不该比错误态还吵').toBeLessThan(count.error);
    for (const n of ILL_NAMES) {
      expect(count[n], `${n} 不该薄于 plain`).toBeGreaterThanOrEqual(count.plain);
    }
  });

  it('尘埃母题在每张里都在（品牌签名，也是六个状态唯一共有的元素）', () => {
    for (const n of ILL_NAMES) {
      const dust = nodes(n).filter((x) => x.k === 'c' && x.f === true);
      expect(dust.length, `${n} 的尘埃点`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('插画语言 · 画幅', () => {
  /*
   * 真正的不变量是"图形不会变形"，而那是 SVG 默认的 preserveAspectRatio="xMidYMid meet"
   * 保证的 —— 盒子比例差一点，多出来的只是几分之一像素的留白，不是拉伸。
   * 所以这里断言"差得不多"（挡住把宽高写反、或某一轴被单独改过这类真错），
   * 而不是"必须严格等比"：card 120x88 是提案里批准的数字，不该为了凑整去改它。
   */
  it('只有两档，画幅比例都接近 viewBox（差太多说明某一轴被单独改过）', () => {
    const [vw, vh] = ILL_VIEW_BOX.split(' ').slice(2).map(Number);
    const ratio = vw / vh;
    for (const [name, d] of Object.entries(ILL_SIZES)) {
      expect(d.w).toBeGreaterThan(0);
      expect(Math.abs(d.w / d.h - ratio) / ratio, `${name} 档比例偏差`).toBeLessThan(0.02);
    }
    // 两档之间也只看"是不是某一轴被单独拉过"，不要求整数上严格等比：
    // 88x64 -> 120x88 两轴各放大 1.364 / 1.375，差 0.8%，落在留白里而不是形变上。
    const dw = ILL_SIZES.card.w / ILL_SIZES.plate.w;
    const dh = ILL_SIZES.card.h / ILL_SIZES.plate.h;
    expect(Math.abs(dw - dh) / dh, `两档放大比例不一致：${dw} vs ${dh}`).toBeLessThan(0.02);
  });

  it('名字表非空且无重复（重复键会静默覆盖前一张）', () => {
    expect(ILL_NAMES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(ILL_NAMES).size).toBe(ILL_NAMES.length);
  });
});
