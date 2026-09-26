/**
 * 对比度审计（UI 阶段 1 的验收工具，docs/ui-optimization.md §4）
 *
 * 为什么不用 axe-core：axe 的 color-contrast 规则在**渐变/半透明叠层**上会直接判 incomplete
 * 而不是 fail —— 恰好是我们最需要盯的那类（极光压在文字底下）。这里自己算：
 * 沿祖先链把半透明背景逐层合成到不透明底上，再按 WCAG 公式出实际比值。
 * 遇到渐变/图片背景无法合成的，单独计为 unresolved（不静默放过，也不误报）。
 */
import type { Page } from '@playwright/test';

export interface ContrastIssue {
  selector: string;
  text: string;
  color: string;
  /** 合成后的实际背景（solid 才能算） */
  background: string;
  ratio: number;
  need: number;
  fontSize: number;
  fontWeight: number;
  /** 背景链上出现过渐变：合成值是近似值，实际底会在此上下浮动 */
  overGradient?: boolean;
}

export interface ContrastReport {
  page: string;
  checked: number;
  /** 背景链上含渐变（极光/玻璃）的样本数，属近似判定 */
  overGradient: number;
  issues: ContrastIssue[];
}

/** 在浏览器里执行的实现体：不能引用外部闭包变量 */
const COLLECT = () => {
  const sel = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).slice(0, 2).join('.');
    return cls ? `${tag}.${cls}` : tag;
  };
  const parse = (s: string): [number, number, number, number] => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 0];
    const p = m[1]
      .split(/[,\s/]+/)
      .filter(Boolean)
      .map(Number);
    return [p[0] || 0, p[1] || 0, p[2] || 0, p.length > 3 ? p[3] : 1];
  };
  const lum = (r: number, g: number, b: number) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (fg: number[], alpha: number, bg: number[]) =>
    fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

  const out: { issues: unknown[]; checked: number; overGradient: number } = {
    issues: [],
    checked: 0,
    overGradient: 0,
  };

  /*
   * 极光画在 body::before 上 —— 伪元素不在 parentElement 链里，光靠遍历看不见它。
   * 必须显式取回来：否则"玻璃背后那层渐变"会从口径里消失，glassWorstCase 归零
   * 只是把指标挪出了视野（阶段 3 把极光从 body 的 background 挪到 ::before 时，
   * 这个假象就发生过一次）。
   */
  const auroraStops: number[][] = [];
  {
    const ps = getComputedStyle(document.body, '::before');
    const img = ps.backgroundImage || '';
    if (img && img !== 'none') {
      const layerOpacity = Number(ps.opacity);
      const op = Number.isFinite(layerOpacity) ? layerOpacity : 1;
      for (const m of img.matchAll(/rgba?\(([^)]+)\)/g)) {
        const p = m[1]
          .split(/[,\s/]+/)
          .filter(Boolean)
          .map(Number);
        const a = (p.length > 3 ? p[3] : 1) * op;
        if (a > 0.01) auroraStops.push([p[0], p[1], p[2], a]);
      }
    }
  }
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('*'));
  for (const el of nodes) {
    const text = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => (n.textContent || '').trim())
      .join(' ')
      .trim();
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;

    /*
     * 背景合成：沿祖先链把半透明层逐层压到不透明底上。
     *
     * 关键处理 —— 渐变不能跳过。液态玻璃把极光画在 body 上，面板又是半透明白，
     * 于是"实际底色"取决于文字正好压在光斑的哪个位置。这里把渐变里出现过的
     * 每个颜色都当作一次底色，取**最坏情况**判定：过不了就是过不了，不能靠运气。
     * （实测：设置弹窗的次要文字在玻璃叠暗色遮罩后落到 3.59:1，属真阳性。）
     */
    let stack: number[][] = [];
    let bases: number[][] = [];
    let cur: HTMLElement | null = el;
    let overGradient = false;
    while (cur) {
      const s = getComputedStyle(cur);
      if (s.backgroundImage && s.backgroundImage !== 'none') {
        overGradient = true;
        for (const m of s.backgroundImage.matchAll(/rgba?\(([^)]+)\)/g)) {
          const p = m[1]
            .split(/[,\s/]+/)
            .filter(Boolean)
            .map(Number);
          const a = p.length > 3 ? p[3] : 1;
          if (a >= 0.999) bases.push([p[0], p[1], p[2]]);
          else stack.push([p[0], p[1], p[2], a]);
        }
      }
      const [rr, gg, bb, aa] = parse(s.backgroundColor);
      if (aa > 0) {
        stack.push([rr, gg, bb, aa]);
        if (aa >= 0.999) {
          bases.push([rr, gg, bb]);
          break;
        }
      }
      cur = cur.parentElement;
    }
    if (!bases.length) bases.push([255, 255, 255]);
    // 只保留最靠外（最后压入）的那层不透明底，其上的半透明层才需要合成
    const base = bases[bases.length - 1];
    let acc = [base[0], base[1], base[2]];
    for (let i = stack.length - 1; i >= 0; i--) {
      const [rr, gg, bb, aa] = stack[i];
      acc = over([rr, gg, bb], aa, acc);
    }
    const [fr, fg2, fb] = parse(cs.color);
    const l1 = lum(fr, fg2, fb);
    const against = (bg: number[]) => {
      const l2 = lum(bg[0], bg[1], bg[2]);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    // 渐变里的每个颜色都试一遍，取最坏
    let ratio = against(acc);
    for (const g of bases) {
      let a2 = [g[0], g[1], g[2]];
      for (let i = stack.length - 1; i >= 0; i--) {
        const [rr, gg, bb, aa] = stack[i];
        a2 = over([rr, gg, bb], aa, a2);
      }
      ratio = Math.min(ratio, against(a2));
    }
    /*
     * 玻璃层之下还可能有极光：链上存在半透明层时，把每个光斑颜色当作"最外圈底色"
     * 再压一遍，取最坏。判定仍走 AA 阈值，但记为 overGradient —— 这类是近似值，
     * 记账并随版本下降，不混进"纯色底失败"那一档。
     */
    const translucent = stack.some((l) => l.length > 3 && l[3] < 0.999);
    if (translucent && auroraStops.length) {
      overGradient = true;
      for (const stop of auroraStops) {
        let a3 = over([stop[0], stop[1], stop[2]], stop[3], acc);
        for (let i = stack.length - 1; i >= 0; i--) {
          const [rr, gg, bb, aa] = stack[i];
          a3 = over([rr, gg, bb], aa, a3);
        }
        ratio = Math.min(ratio, against(a3));
      }
    }
    const fontSize = parseFloat(cs.fontSize) || 16;
    const fontWeight = parseInt(cs.fontWeight, 10) || 400;
    // WCAG：大字（≥24px，或 ≥18.66px 且 bold）只需 3:1
    const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    const need = large ? 3 : 4.5;
    out.checked += 1;
    // 注意：这里曾经写成 out.unresolved += 1 —— 对象上没这个字段，
    // 于是"样本数"永远是 0，无法证明渐变口径真的在跑（e2e 目录不在任何 tsconfig 里，
    // 类型检查也抓不到）。改回声明过的 overGradient 计数。
    if (overGradient) out.overGradient += 1;
    if (ratio < need - 0.01) {
      out.issues.push({
        selector: sel(el),
        text: text.slice(0, 40),
        color: cs.color,
        background: `rgb(${acc.map((n) => Math.round(n)).join(', ')})`,
        ratio: Math.round(ratio * 100) / 100,
        need,
        fontSize,
        fontWeight,
        overGradient,
      });
    }
  }
  return out;
};

export async function auditContrast(page: Page, name: string): Promise<ContrastReport> {
  const raw = await page.evaluate(COLLECT as unknown as () => ReturnType<typeof COLLECT>);
  return {
    page: name,
    checked: raw.checked,
    overGradient: raw.overGradient,
    issues: raw.issues as ContrastIssue[],
  };
}
