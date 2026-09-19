/**
 * 模式状态管理（web 端薄封装）
 *
 * 状态机已下沉到 @dustnote/client-core 的 createModeStore（审计 ARCH-002
 * 后续项）。这里保留 web 平台差异：localStorage 同步读写、serverUrl 同步到
 * URL 参数（便于书签）、resetMode 时打「首访默认联机已应用」标记。
 */

import { useStore } from 'zustand';
import type { ModeState } from '@dustnote/shared';
import {
  createModeStore,
  MODE_STORAGE_KEY,
  type ModeStoreState,
  toModeState,
} from '@dustnote/client-core';

const STORAGE_KEY = MODE_STORAGE_KEY;

/** 同步服务器地址到 URL 参数（便于书签，清空数据后仍可自动连接） */
function syncUrl(serverUrl: string | null): void {
  try {
    const url = new URL(location.href);
    if (serverUrl) {
      url.searchParams.set('server', serverUrl);
    } else {
      url.searchParams.delete('server');
    }
    history.replaceState(null, '', url.toString());
  } catch {
    /* SSR / 非浏览器环境 */
  }
}

function load(): Partial<ModeState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Partial<ModeState>;
  } catch {
    /* ignore corrupted state */
  }
  return null;
}

function save(state: ModeState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage 不可用（隐私模式等），忽略 */
  }
}

export const modeStore = createModeStore({
  load,
  save,
  onServerUrlChange: syncUrl,
  onBeforeReset: markModeDefaultApplied,
});

/** zustand 同形门面：hook（可选选择器）+ getState/setState/subscribe */
type ModeStoreHook = {
  (): ModeStoreState;
  <T>(selector: (s: ModeStoreState) => T): T;
  getState: typeof modeStore.getState;
  setState: typeof modeStore.setState;
  subscribe: typeof modeStore.subscribe;
};

function useModeStoreImpl<T>(selector?: (s: ModeStoreState) => T): T | ModeStoreState {
  return selector ? useStore(modeStore, selector) : useStore(modeStore);
}

export const useModeStore = useModeStoreImpl as ModeStoreHook;
useModeStore.getState = modeStore.getState;
useModeStore.setState = modeStore.setState;
useModeStore.subscribe = modeStore.subscribe;

/**
 * 「首次访问默认联机」是否已应用过。
 *
 * web 端首访自动进联机模式（同源地址，免去选模式填地址）；但用户点
 * 「重新选择模式」后必须能真正进到选择界面——因此用一个持久标记区分
 * 「首访」与「用户主动重置」：标记存在时不再自动选联机。
 */
const MODE_DEFAULT_APPLIED_KEY = 'dustnote_mode_default_applied';

export function hasModeDefaultApplied(): boolean {
  try {
    return localStorage.getItem(MODE_DEFAULT_APPLIED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markModeDefaultApplied(): void {
  try {
    localStorage.setItem(MODE_DEFAULT_APPLIED_KEY, '1');
  } catch {
    /* ignore */
  }
}

/**
 * 获取当前模式（非 React 上下文使用）
 */
export function getCurrentMode(): ModeState {
  return toModeState(modeStore.getState());
}
