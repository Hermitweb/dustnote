/**
 * 模式状态管理（安卓端薄封装）
 *
 * 状态机已下沉到 @dustnote/client-core 的 createModeStore（审计 ARCH-002
 * 后续项）。这里保留平台差异：AsyncStorage 异步持久化（起步 hydrated=false，
 * 启动时自动 hydrate 一次，与 mobile/src/theme.ts 同款模式），以及
 * DEFAULT_BASE_URL / resolveBaseUrl 两个安卓专属 URL 解析。
 */

import { useStore } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ModeState } from '@dustnote/shared';
import {
  createModeStore,
  MODE_STORAGE_KEY,
  type ModeStoreState,
  toModeState,
} from '@dustnote/client-core';

const STORAGE_KEY = MODE_STORAGE_KEY;

/** 默认 baseUrl：联机模式下未配置 serverUrl 时的回退值（真机调试用 adb reverse 转发） */
export const DEFAULT_BASE_URL = 'http://localhost:3210/api/v1';

function load(): Partial<ModeState> | null {
  // AsyncStorage 是异步的：起步用默认值，hydrate() 里再覆盖
  return null;
}

function save(state: ModeState): void {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => undefined);
}

export const modeStore = createModeStore({ load, save, startsUnhydrated: true });

/** zustand 同形门面：hook + getState/setState/subscribe（原调用点零改动） */
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

/** 启动时从 AsyncStorage 加载一次（与 theme.ts 保持一致的 hydrate 模式） */
async function hydrate(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      modeStore
        .getState()
        .applyHydrated({ mode: 'standalone', serverUrl: null, initialized: false });
      return;
    }
    modeStore.getState().applyHydrated(JSON.parse(raw) as ModeState);
  } catch (e) {
    // 极端情况：AsyncStorage 不可用 / 内容损坏
    console.warn('[mode-store] hydrate failed', e);
    modeStore.getState().applyHydrated({ mode: 'standalone', serverUrl: null, initialized: false });
  }
}
void hydrate();

/** 从 store 状态中提取出纯 ModeState（剔除 actions / hydrated） */
export function getCurrentMode(): ModeState {
  return toModeState(modeStore.getState());
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
