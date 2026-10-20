/**
 * web/src/lib/effect.ts 单测 —— 材质 / 极光偏好（玻璃+极光的 localStorage 开关）
 *
 * 覆盖：
 *   - DEFAULT_EFFECT 默认值
 *   - loadEffectPrefs：无 key → default / 合法值 / 非法 aurora 回退 / 非法 effect 回退 / JSON 解析失败
 *   - applyEffect：glass 模式保留 aurora / flat 模式强制 aurora=0 / 写 dataset + style
 *   - useEffectStore.setEffect：set + persist + apply
 *   - useEffectStore.setAurora：set + persist + apply
 *   - isAurora（间接通过 loadEffectPrefs 验证）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installPolyfills } from '../test/polyfills';

installPolyfills();

import {
  loadEffectPrefs,
  applyEffect,
  useEffectStore,
  AURORA_LEVELS,
  DEFAULT_EFFECT,
  EFFECT_STORAGE_KEY,
} from './effect';

describe('effect（材质+极光）', () => {
  beforeEach(() => {
    localStorage.removeItem(EFFECT_STORAGE_KEY);
    // 重置 store 状态
    useEffectStore.setState({ ...DEFAULT_EFFECT });
    // 还原 document.documentElement
    delete document.documentElement.dataset.effect;
    document.documentElement.style.removeProperty('--mn-aurora');
  });

  describe('常量', () => {
    it('DEFAULT_EFFECT = glass + 0.5', () => {
      expect(DEFAULT_EFFECT).toEqual({ effect: 'glass', aurora: 0.5 });
    });

    it('AURORA_LEVELS = [0, 0.5, 1, 1.4]', () => {
      expect(AURORA_LEVELS).toEqual([0, 0.5, 1, 1.4]);
    });
  });

  describe('loadEffectPrefs', () => {
    it('无 key → 默认值', () => {
      expect(loadEffectPrefs()).toEqual(DEFAULT_EFFECT);
    });

    it('合法值 → 解析', () => {
      localStorage.setItem(EFFECT_STORAGE_KEY, JSON.stringify({ effect: 'flat', aurora: 1 }));
      expect(loadEffectPrefs()).toEqual({ effect: 'flat', aurora: 1 });
    });

    it('非法 effect → 回退 glass', () => {
      localStorage.setItem(EFFECT_STORAGE_KEY, JSON.stringify({ effect: 'bogus', aurora: 1 }));
      expect(loadEffectPrefs().effect).toBe('glass');
    });

    it('非法 aurora → 回退默认 0.5', () => {
      localStorage.setItem(EFFECT_STORAGE_KEY, JSON.stringify({ effect: 'glass', aurora: 5 }));
      expect(loadEffectPrefs().aurora).toBe(DEFAULT_EFFECT.aurora);
    });

    it('JSON 解析失败 → 默认值', () => {
      localStorage.setItem(EFFECT_STORAGE_KEY, '{not json');
      expect(loadEffectPrefs()).toEqual(DEFAULT_EFFECT);
    });
  });

  describe('applyEffect', () => {
    it('glass + aurora=1 → dataset.effect="glass" + --mn-aurora=1', () => {
      applyEffect({ effect: 'glass', aurora: 1 });
      expect(document.documentElement.dataset.effect).toBe('glass');
      expect(document.documentElement.style.getPropertyValue('--mn-aurora')).toBe('1');
    });

    it('flat + aurora=1 → dataset.effect="flat" + --mn-aurora=0（强制归零）', () => {
      applyEffect({ effect: 'flat', aurora: 1 });
      expect(document.documentElement.dataset.effect).toBe('flat');
      expect(document.documentElement.style.getPropertyValue('--mn-aurora')).toBe('0');
    });

    it('不传参 → 用 loadEffectPrefs 现行值', () => {
      localStorage.setItem(EFFECT_STORAGE_KEY, JSON.stringify({ effect: 'flat', aurora: 1.4 }));
      applyEffect();
      expect(document.documentElement.dataset.effect).toBe('flat');
      expect(document.documentElement.style.getPropertyValue('--mn-aurora')).toBe('0');
    });
  });

  describe('useEffectStore', () => {
    it('setEffect(flat) → state.effect=flat + persist + apply', () => {
      useEffectStore.getState().setEffect('flat');
      expect(useEffectStore.getState().effect).toBe('flat');
      const stored = JSON.parse(localStorage.getItem(EFFECT_STORAGE_KEY) ?? '{}');
      expect(stored.effect).toBe('flat');
      expect(document.documentElement.dataset.effect).toBe('flat');
    });

    it('setAurora(1) → state.aurora=1 + persist + apply', () => {
      useEffectStore.getState().setAurora(1);
      expect(useEffectStore.getState().aurora).toBe(1);
      const stored = JSON.parse(localStorage.getItem(EFFECT_STORAGE_KEY) ?? '{}');
      expect(stored.aurora).toBe(1);
      expect(document.documentElement.style.getPropertyValue('--mn-aurora')).toBe('1');
    });

    it('persist 失败（localStorage 抛错）→ 不崩', () => {
      const setItem = vi.fn(() => {
        throw new Error('quota exceeded');
      });
      // simulate storage setItem throwing
      const origSet = Storage.prototype.setItem;
      Storage.prototype.setItem = setItem;
      try {
        expect(() => useEffectStore.getState().setAurora(1.4)).not.toThrow();
      } finally {
        Storage.prototype.setItem = origSet;
      }
    });
  });
});
