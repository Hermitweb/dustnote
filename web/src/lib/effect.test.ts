/** 材质与极光偏好测试（阶段 3） */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadEffectPrefs,
  applyEffect,
  DEFAULT_EFFECT,
  EFFECT_STORAGE_KEY,
  AURORA_LEVELS,
} from './effect';

describe('loadEffectPrefs', () => {
  beforeEach(() => localStorage.clear());

  it('没有存过 → 默认玻璃 + 柔和极光', () => {
    expect(loadEffectPrefs()).toEqual(DEFAULT_EFFECT);
    expect(DEFAULT_EFFECT.aurora).toBeLessThan(1); // 默认不再是"吃满"的那档
  });

  it('存的值合法就照收', () => {
    localStorage.setItem(EFFECT_STORAGE_KEY, JSON.stringify({ effect: 'flat', aurora: 1 }));
    expect(loadEffectPrefs()).toEqual({ effect: 'flat', aurora: 1 });
  });

  it('脏值回落到默认，而不是把 NaN 写进 CSS', () => {
    for (const raw of ['not json', '{}', '{"effect":"blur","aurora":9}', '{"aurora":null}']) {
      localStorage.setItem(EFFECT_STORAGE_KEY, raw);
      const p = loadEffectPrefs();
      expect(['glass', 'flat']).toContain(p.effect);
      expect(AURORA_LEVELS).toContain(p.aurora);
    }
  });
});

describe('applyEffect', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.effect;
    document.documentElement.style.removeProperty('--mn-aurora');
  });

  it('写 data-effect 与乘数，材质切换不动布局属性', () => {
    applyEffect({ effect: 'glass', aurora: 1.4 });
    expect(document.documentElement.dataset.effect).toBe('glass');
    expect(document.documentElement.style.getPropertyValue('--mn-aurora')).toBe('1.4');
  });

  it('关闭玻璃时极光强制归零（否则文字直接压在渐变上）', () => {
    applyEffect({ effect: 'flat', aurora: 1.4 });
    expect(document.documentElement.dataset.effect).toBe('flat');
    expect(document.documentElement.style.getPropertyValue('--mn-aurora')).toBe('0');
  });

  it('不传参则读本机存过的偏好', () => {
    localStorage.setItem(EFFECT_STORAGE_KEY, JSON.stringify({ effect: 'flat', aurora: 0 }));
    applyEffect();
    expect(document.documentElement.dataset.effect).toBe('flat');
    expect(document.documentElement.style.getPropertyValue('--mn-aurora')).toBe('0');
  });
});
