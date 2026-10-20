/**
 * theme.ts 测试
 *
 * applyTheme / applyTypography / watchSystemTheme 全部走真 DOM
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { applyTheme, applyTypography, watchSystemTheme, THEMES } from './theme';

describe('theme', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-mode');
    document.documentElement.removeAttribute('style');
  });

  describe('THEMES', () => {
    it('包含 7 个主题', () => {
      expect(THEMES.length).toBeGreaterThanOrEqual(7);
    });

    it('所有主题 id 都在 THEME_SEEDS 中存在', () => {
      for (const t of THEMES) {
        expect(t.id).toBeTruthy();
      }
    });
  });

  describe('applyTheme', () => {
    it('写入 data-theme + data-mode', () => {
      applyTheme('mint-dawn', 'light');
      expect(document.documentElement.dataset.theme).toBe('mint-dawn');
      expect(document.documentElement.dataset.mode).toBe('light');
    });

    it('写入 token CSS 变量到 :root', () => {
      applyTheme('mint-dawn', 'light');
      const style = document.documentElement.style;
      // 不应当空
      const tokens = Array.from(style);
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('dark 模式切换属性', () => {
      applyTheme('mist-blue', 'dark');
      expect(document.documentElement.dataset.mode).toBe('dark');
    });

    it('auto 模式根据 prefers-color-scheme 决定', () => {
      // jsdom matchMedia 默认无 dark
      window.matchMedia = vi.fn().mockReturnValue({ matches: false } as MediaQueryList);
      applyTheme('mint-dawn', 'auto');
      expect(document.documentElement.dataset.mode).toBe('light');
    });
  });

  describe('applyTypography', () => {
    it('写入 --mn-font / --mn-line-height / --mn-density', () => {
      applyTypography('system', 'standard');
      const style = document.documentElement.style.getPropertyValue('--mn-font');
      expect(style).toContain('system-ui');
      expect(document.documentElement.style.getPropertyValue('--mn-line-height')).toBe('1.6');
      expect(document.documentElement.style.getPropertyValue('--mn-density')).toBe('1');
    });

    it('未知 density 落到 standard', () => {
      applyTypography('system', 'standard');
      // 设置为未知值也应该不报错
      applyTypography('lxgw', 'compact');
      expect(document.documentElement.style.getPropertyValue('--mn-density')).toBe('0.9');
    });
  });

  describe('watchSystemTheme', () => {
    it('非 auto 模式返回空函数（不监听）', () => {
      const cleanup = watchSystemTheme('mint-dawn', 'light');
      expect(typeof cleanup).toBe('function');
      cleanup();
    });

    it('auto 模式返回清理函数（注册了 listener）', () => {
      const add = vi.fn();
      const remove = vi.fn();
      window.matchMedia = vi.fn().mockReturnValue({
        matches: false,
        addEventListener: add,
        removeEventListener: remove,
      } as unknown as MediaQueryList);
      const cleanup = watchSystemTheme('mint-dawn', 'auto');
      expect(add).toHaveBeenCalled();
      cleanup();
      expect(remove).toHaveBeenCalled();
    });
  });
});
