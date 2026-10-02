/**
 * 图标轨标签浮层（§2.1 断点里的"读标签名"）
 *
 * 为什么不是原来的 `title`：原生 tooltip 有两个硬伤——(1) 有 ~1s 延迟，鼠标扫过列表时
 * 基本读不到；(2) 它同时是屏幕阅读器的无障碍名来源，等于"给键盘/读屏用的东西"和
 * "给眼睛用的东西"挤在同一个属性上。现在无障碍名走 aria-label、视觉提示走这里。
 *
 * 为什么只在 1024–1279 生效：≥1280 标签本来就显示着，再弹一层是噪声；<1024 是抽屉态。
 *
 * 为什么用 portal：轨道本身是 `glass-1`（backdrop-filter）+ 可滚动容器——两者都会给
 * `position: fixed` 的后代造出新的包含块，直接嵌在轨道里的浮层会跟着轨道定位而不是视口，
 * 表现就是"浮层跑到屏幕外/压住条目"。挂到 body 上才与祖先的 transform/filter 无关。
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/** 与 tokens.css 里那条 @media 保持同一区间（改一处必须改另一处） */
const MINI_QUERY = '(min-width: 1024px) and (max-width: 1279.98px)';
const GAP = 8;

/**
 * 传 ref 而不是传 `ref.current`：后者在首次渲染时是 null，而 effect 依赖它也不会
 * 因为 ref 被填充而重新执行——浮层就永远挂不上。effect 在 DOM 落好之后才跑，
 * 那时读 root.current 才有值。
 */
export function RailLabelTip({ root }: { root: RefObject<HTMLElement | null> }) {
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  const mini = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia(MINI_QUERY);
    const sync = () => {
      mini.current = mq.matches;
      if (!mq.matches) setTip(null);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const show = (el: Element | null) => {
      const holder = el?.closest?.('[data-rail-label]');
      const text = holder?.getAttribute('data-rail-label');
      if (!mini.current || !holder || !text) {
        setTip(null);
        return;
      }
      const r = holder.getBoundingClientRect();
      setTip({ text, top: r.top + r.height / 2, left: r.right + GAP });
    };
    const hide = () => setTip(null);
    const onOver = (e: Event) => show((e.target as Element) ?? null);
    const onFocus = (e: Event) => show((e.target as Element) ?? null);
    el.addEventListener('pointerover', onOver);
    el.addEventListener('pointerleave', hide);
    el.addEventListener('focusin', onFocus);
    el.addEventListener('focusout', hide);
    return () => {
      el.removeEventListener('pointerover', onOver);
      el.removeEventListener('pointerleave', hide);
      el.removeEventListener('focusin', onFocus);
      el.removeEventListener('focusout', hide);
    };
  }, [root]);

  if (!tip) return null;
  return createPortal(
    <div className="rail-tip" style={{ top: tip.top, left: tip.left }} aria-hidden="true">
      {tip.text}
    </div>,
    document.body
  );
}
