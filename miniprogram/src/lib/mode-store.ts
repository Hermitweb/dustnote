/**
 * 模式状态管理（v2.0.0 单机/联机双模式）
 *
 * - standalone：单机模式，无服务器，数据存储在本地 Taro.setStorage
 * - online：联机模式，连接服务器解锁全部功能
 *
 * 持久化到 Taro.setStorage（key: 'dustnote_mode_state'）
 * 首次启动时 initialized=false，用户选择模式后设为 true
 *
 * 注意：小程序的 Taro.setStorage 是异步的，但模块加载时若用同步读取
 * 需使用 Taro.getStorageSync。这里采用同步读取初始值 + 异步写入的策略，
 * 与 state/theme.ts 的模式一致。
 */

import { create } from 'zustand';
import Taro from '@tarojs/taro';
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

/**
 * 同步读取初始状态（模块加载时调用）
 *
 * Taro.getStorageSync 在 weapp / h5 / 各小程序平台均提供同步版本，
 * 适合作为 zustand store 的初始值。读取失败时回退到默认状态。
 */
function loadInitialState(): ModeState {
  try {
    const raw = Taro.getStorageSync(STORAGE_KEY);
    if (raw) {
      const parsed =
        typeof raw === 'string'
          ? (JSON.parse(raw) as Partial<ModeState>)
          : (raw as Partial<ModeState>);
      return { ...DEFAULT_STATE, ...parsed };
    }
  } catch {
    /* 存储损坏或不可用，忽略 */
  }
  return DEFAULT_STATE;
}

/**
 * 异步持久化模式状态
 *
 * Taro.setStorage 是异步的（返回 Promise），但写入失败不应阻塞 UI，
 * 因此 fire-and-forget。
 */
async function saveState(state: ModeState): Promise<void> {
  try {
    await Taro.setStorage({ key: STORAGE_KEY, data: JSON.stringify(state) });
  } catch {
    /* 存储不可用时忽略 */
  }
}

export const useModeStore = create<ModeStore>((set, get) => ({
  ...loadInitialState(),

  setMode(mode: AppMode): void {
    const next = { ...get(), mode };
    void saveState(next);
    set({ mode });
  },

  setServerUrl(url: string | null): void {
    const next = { ...get(), serverUrl: url };
    void saveState(next);
    set({ serverUrl: url });
  },

  initialize(): void {
    const next = { ...get(), initialized: true };
    void saveState(next);
    set({ initialized: true });
  },

  resetMode(): void {
    void saveState(DEFAULT_STATE);
    set(DEFAULT_STATE);
  },
}));

/**
 * 获取当前模式（非 React 上下文使用，如 lib/repository.ts 工厂）
 */
export function getCurrentMode(): ModeState {
  return useModeStore.getState();
}
