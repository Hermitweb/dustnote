/**
 * store 单元测试（最小化）
 *
 * store.ts 依赖大量外部状态（API、IndexedDB、i18n 等），
 * 此文件仅验证模块可正常导入且初始状态结构正确。
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('idb-keyval', () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => undefined),
  del: vi.fn(async () => undefined),
}));

const { useStore } = await import('./store');

describe('store', () => {
  it('exports a usable store with initial state', () => {
    const state = useStore.getState();
    expect(state).toBeDefined();
    expect(state.authState).toBeDefined();
    expect(state.notes).toBeInstanceOf(Map);
    expect(state.notesPlain).toBeInstanceOf(Map);
    expect(state.preferences).toBeDefined();
    expect(state.preferences.theme).toBeDefined();
    expect(state.preferences.language).toBeDefined();
  });

  it('initializes with empty notes and folders', () => {
    const state = useStore.getState();
    expect(state.notes.size).toBe(0);
    expect(state.folders).toEqual([]);
  });

  it('exposes core actions', () => {
    const state = useStore.getState();
    expect(typeof state.loadAll).toBe('function');
    expect(typeof state.createNote).toBe('function');
    expect(typeof state.updateNote).toBe('function');
    expect(typeof state.setPreferences).toBe('function');
    expect(typeof state.clearLocalData).toBe('function');
  });
});
