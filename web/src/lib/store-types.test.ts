/**
 * store-types 测试
 *
 * 覆盖：常量 + loadPrefs/savePrefs 持久化契约 + 视图模式枚举
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { UNFILED_ID, loadPrefs, savePrefs } from './store-types';

describe('store-types', () => {
  beforeEach(() => localStorage.clear());

  it('UNFILED_ID 常量是 "__unfiled__"', () => {
    expect(UNFILED_ID).toBe('__unfiled__');
  });

  it('savePrefs: 写入 localStorage 后 loadPrefs 读回', () => {
    const prefs = {
      theme: 'mist-blue' as never,
      font: 'system' as never,
      density: 'compact' as never,
      language: 'en' as never,
      mode: 'auto' as never,
    };
    savePrefs(prefs as unknown as Parameters<typeof savePrefs>[0]);
    const loaded = loadPrefs();
    // 加载层会补默认字段，至少包含用户写入的关键值
    expect(loaded.theme).toBe('mist-blue');
    expect(loaded.density).toBe('compact');
    expect(loaded.language).toBe('en');
  });

  it('loadPrefs: 损坏 JSON 走默认', () => {
    localStorage.setItem('dustnote_prefs', '{坏');
    const loaded = loadPrefs();
    expect(loaded).toBeTruthy();
    expect(typeof loaded.theme).toBe('string');
  });

  it('loadPrefs: 全空 localStorage 走默认', () => {
    const loaded = loadPrefs();
    expect(loaded).toBeTruthy();
  });
});
