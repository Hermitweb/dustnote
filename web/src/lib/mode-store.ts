/**
 * 模式状态管理（v2.0.0 单机/联机双模式）
 *
 * - standalone：单机模式，无服务器，数据存储在本地 IndexedDB
 * - online：联机模式，连接服务器解锁全部功能
 *
 * 持久化到 localStorage（key: 'dustnote_mode_state'）
 * 首次启动时 initialized=false，用户选择模式后设为 true
 */

import { create } from 'zustand';
import type { AppMode, ModeState } from '@dustnote/shared';

const STORAGE_KEY = 'dustnote_mode_state';

interface ModeStore extends ModeState {
  /** 设置当前模式（不会自动标记为已初始化） */
  setMode: (mode: AppMode) => void;
  /** 设置服务器地址（仅 online 模式有效） */
  setServerUrl: (url: string | null) => void;
  /** 标记模式选择完成，首次启动后调用 */
  initialize: () => void;
  /** 重置模式状态（注销或切换模式时调用） */
  resetMode: () => void;
}

const DEFAULT_STATE: ModeState = {
  mode: 'standalone',
  serverUrl: null,
  initialized: false,
};

function loadState(): ModeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ModeState>;
      return { ...DEFAULT_STATE, ...parsed };
    }
  } catch {
    /* ignore corrupted state */
  }
  return DEFAULT_STATE;
}

function saveState(state: ModeState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage 不可用（隐私模式等），忽略 */
  }
}

export const useModeStore = create<ModeStore>((set, get) => ({
  ...loadState(),

  setMode(mode: AppMode): void {
    const next = { ...get(), mode };
    saveState(next);
    set({ mode });
  },

  setServerUrl(url: string | null): void {
    const next = { ...get(), serverUrl: url };
    saveState(next);
    set({ serverUrl: url });
  },

  initialize(): void {
    const next = { ...get(), initialized: true };
    saveState(next);
    set({ initialized: true });
  },

  resetMode(): void {
    saveState(DEFAULT_STATE);
    set(DEFAULT_STATE);
  },
}));

/**
 * 获取当前模式（非 React 上下文使用）
 */
export function getCurrentMode(): ModeState {
  return useModeStore.getState();
}
