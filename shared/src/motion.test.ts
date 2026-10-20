/**
 * shared/motion.ts 单测 —— 动效令牌（跨端单一实现）
 */
import { describe, it, expect } from 'vitest';
import { MOTION, MOTION_CSS_VARS, MOTION_SNAP } from './motion.js';

describe('MOTION', () => {
  it('fast < med < slow（递增档位）', () => {
    expect(MOTION.fast).toBe(120);
    expect(MOTION.med).toBe(180);
    expect(MOTION.slow).toBe(240);
  });

  it('ease 是 Material standard 曲线（cubic-bezier(0.2, 0, 0, 1)）', () => {
    expect(MOTION.ease).toBe('cubic-bezier(0.2, 0, 0, 1)');
  });
});

describe('MOTION_CSS_VARS', () => {
  it('与 MOTION 数值一致（生成器断言）', () => {
    expect(MOTION_CSS_VARS['--mn-duration-fast']).toBe('120ms');
    expect(MOTION_CSS_VARS['--mn-duration-med']).toBe('180ms');
    expect(MOTION_CSS_VARS['--mn-duration-slow']).toBe('240ms');
    expect(MOTION_CSS_VARS['--mn-ease']).toBe(MOTION.ease);
  });
});

describe('MOTION_SNAP', () => {
  it('easing 是 ease-out cubic（0→0, 1→1, 单调递增 + 起步快）', () => {
    const easing = MOTION_SNAP.easing;
    expect(easing(0)).toBe(0);
    expect(easing(1)).toBe(1);
    // ease-out 起步快收尾慢：t=0.25 时已过一半
    expect(easing(0.25)).toBeCloseTo(0.578, 2);
    expect(easing(0.5)).toBe(0.875);
    expect(easing(0.75)).toBeCloseTo(0.984, 2);
    // 单调递增
    expect(easing(0.25)).toBeLessThan(easing(0.5));
    expect(easing(0.5)).toBeLessThan(easing(0.75));
  });

  it('duration 与 MOTION.med 一致', () => {
    expect(MOTION_SNAP.duration).toBe(MOTION.med);
  });
});
