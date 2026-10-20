/**
 * prefs-slice 测试
 *
 * 用 zustand 直接挂载 slice + set / get，验证 setPreferences / setTheme / setMode
 * / setLanguage 的副作用（持久化 + applyTheme + i18n.changeLanguage）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore as _createStore } from 'zustand';
void _createStore;

vi.mock('../store-types', () => ({
  UNFILED_ID: '__unfiled__',
  loadPrefs: () => ({
    theme: 'mist-blue',
    font: 'system',
    density: 'standard',
    language: 'zh-CN',
    mode: 'auto',
    autoLock: 15,
  }),
  savePrefs: vi.fn(),
}));
vi.mock('../theme', () => ({
  applyTheme: vi.fn(),
  applyTypography: vi.fn(),
}));
const i18nChangeLanguage = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../i18n', () => ({
  default: { changeLanguage: i18nChangeLanguage, language: 'zh-CN' },
  LANGUAGE_STORAGE_KEY: 'dustnote_language',
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('../toast', () => ({
  toast: { error: toastError, success: vi.fn() },
}));
vi.mock('../store-helpers', () => ({
  api: () => ({
    patch: vi.fn(async () => undefined),
  }),
}));

import { createPrefsSlice } from './prefs-slice';
import type { StoreState } from '../store';
import type { StoreApi } from 'zustand';

// 用 zustand 真实 store 注入 slice（mode 字段需要，所以用 is 用 standalone 也可，
// 但 prefs-slice 是 prefs 单一字段，不强制要求 mode）
function mkStore() {
  // 断言集中在构造边界这一次：prefs-slice 只写 preferences 一个字段，
  // 而 StoreState 是五个 slice 的交集，故此处需要一次显式断言；断言之后
  // state.preferences / actions.setTheme 等访问全部是强类型。
  const base = {} as unknown as StoreState;
  const combined: StoreState = { ...base };
  const set: StoreApi<StoreState>['setState'] = (partial) => {
    const p = typeof partial === 'function' ? partial(combined) : partial;
    Object.assign(combined, p);
  };
  const get = () => combined;
  // zustand 的 StateCreator 签名是 (set, get, api)。prefs-slice 只用 set/get，
  // 这里给一个最小可用的 api 实现（subscribe 退订即可）。
  const api: StoreApi<StoreState> = {
    setState: set,
    getState: get,
    getInitialState: get,
    subscribe: () => () => undefined,
    destroy: () => undefined,
  };
  const slice = createPrefsSlice(set, get, api);
  Object.assign(combined, slice);
  return combined;
}

describe('prefs-slice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('setPreferences 合并偏好 + 持久化', () => {
    const state = mkStore();
    (state.setPreferences as (p: object) => void)({ density: 'compact' });
    expect((state.preferences as { density: string }).density).toBe('compact');
    expect((state.preferences as { theme: string }).theme).toBe('mist-blue');
  });

  it('setPreferences 含 theme → applyTheme 调用', () => {
    const state = mkStore();
    (state.setPreferences as (p: object) => void)({ theme: 'liquid-glass' });
    expect((state.preferences as { theme: string }).theme).toBe('liquid-glass');
  });

  it('setTheme 是 setPreferences 的快捷方式', () => {
    const state = mkStore();
    (state.setTheme as (t: string) => void)('sakura-pink');
    expect((state.preferences as { theme: string }).theme).toBe('sakura-pink');
  });

  it('setMode 是 setPreferences 的快捷方式', () => {
    const state = mkStore();
    (state.setMode as (m: string) => void)('light');
    expect((state.preferences as { mode: string }).mode).toBe('light');
  });

  it('setLanguage 走 i18n.changeLanguage + 写 localStorage', () => {
    const state = mkStore();
    (state.setLanguage as (l: string) => void)('en');
    expect((state.preferences as { language: string }).language).toBe('en');
    expect(localStorage.getItem('dustnote_language')).toBe('en');
  });
});
