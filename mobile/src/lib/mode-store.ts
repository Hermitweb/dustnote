/**
 * 模式状态管理（v2.0.0 单机/联机双模式）
 *
 * - standalone：单机模式，无服务器，数据存储在本地（AsyncStorage）
 * - online：联机模式，连接服务器解锁全部功能
 *
 * 持久化到 AsyncStorage（key: 'dustnote_mode_state'）。
 *
 * 实现说明：
 * - 项目当前未安装 react-native-mmkv，故沿用 mobile 已有的 AsyncStorage 持久化模式
 *   （与 mobile/src/theme.ts 一致：zustand create 同步初始化 + AsyncStorage.getItem 异步 hydrate）
 * - 后续若引入 MMKV，只需替换 loadState/saveState 两个函数即可
 *
 * 首次启动时 initialized=false，用户选择模式后调用 initialize() 设为 true。
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppMode, ModeState } from '@dustnote/shared';

const STORAGE_KEY = 'dustnote_mode_state';

/** 默认 baseUrl：联机模式下未配置 serverUrl 时的回退值（真机调试用 adb reverse 转发） */
export const DEFAULT_BASE_URL = 'http://localhost:3210/api/v1';

interface ModeStore extends ModeState {
  /** 持久化状态是否已从 AsyncStorage 加载完成 */
  hydrated: boolean;
  /** 设置当前模式（不会自动标记为已初始化） */
  setMode: (mode: AppMode) => void;
  /** 设置服务器地址（仅 online 模式有效；null 表示走默认 baseUrl） */
  setServerUrl: (url: string | null) => void;
  /** 标记模式选择完成，首次启动后调用 */
  initialize: () => void;
  /** 重置模式状态（注销或切换模式时调用） */
  resetMode: () => void;
  /** 从 AsyncStorage 加载持久化状态（应用启动时调用一次即可） */
  hydrate: () => Promise<void>;
}

const DEFAULT_STATE: ModeState = {
  mode: 'standalone',
  serverUrl: null,
  initialized: false,
};

async function loadState(): Promise<ModeState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ModeState>;
      return { ...DEFAULT_STATE, ...parsed };
    }
  } catch {
    /* 损坏的状态忽略，使用默认值 */
  }
  return DEFAULT_STATE;
}

async function saveState(state: ModeState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* AsyncStorage 不可用时忽略 */
  }
}

export const useModeStore = create<ModeStore>((set, get) => ({
  ...DEFAULT_STATE,
  hydrated: false,

  setMode(mode: AppMode): void {
    set({ mode });
    void saveState({ ...toModeState(get()), mode });
  },

  setServerUrl(url: string | null): void {
    set({ serverUrl: url });
    void saveState({ ...toModeState(get()), serverUrl: url });
  },

  initialize(): void {
    set({ initialized: true });
    void saveState({ ...toModeState(get()), initialized: true });
  },

  resetMode(): void {
    set({ ...DEFAULT_STATE, hydrated: true });
    void saveState(DEFAULT_STATE);
  },

  async hydrate(): Promise<void> {
    try {
      const state = await loadState();
      set({ ...state, hydrated: true });
    } catch (e) {
      // 极端情况：AsyncStorage 不可用
      console.warn('[mode-store] hydrate failed', e);
      set({ ...DEFAULT_STATE, hydrated: true });
    }
  },
}));

// 启动时自动从 AsyncStorage 加载一次（与 theme.ts 保持一致的 hydrate 模式）
void useModeStore.getState().hydrate();

/** 从 store 状态中提取出纯 ModeState（剔除 actions / hydrated） */
function toModeState(s: ModeStore): ModeState {
  return { mode: s.mode, serverUrl: s.serverUrl, initialized: s.initialized };
}

/**
 * 获取当前模式状态（非 React 上下文使用，例如 api.ts 拦截器）
 */
export function getCurrentMode(): ModeState {
  return toModeState(useModeStore.getState());
}

/**
 * 解析当前应使用的 baseUrl：
 * - online 模式且 serverUrl 非空 → `${serverUrl}/api/v1`
 * - online 模式且 serverUrl 为空 → 抛出错误（联机模式必须配置服务器地址）
 * - standalone 模式 → DEFAULT_BASE_URL
 *
 * serverUrl 期望是不含 /api/v1 后缀的根地址（如 'http://192.168.1.10:3210'）；
 * 若用户已包含 /api/v1 则直接使用。
 */
export function resolveBaseUrl(): string {
  const { mode, serverUrl } = getCurrentMode();
  if (mode === 'online') {
    if (!serverUrl) {
      throw new Error('联机模式未配置服务器地址');
    }
    // 与 miniprogram 端一致：先去除尾部斜杠，避免用户输入 http://host:3210/ 时拼出 //api/v1
    const trimmed = serverUrl.replace(/\/+$/, '');
    return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
  }
  return DEFAULT_BASE_URL;
}
