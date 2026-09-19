/**
 * 模式状态管理（小程序端薄封装）
 *
 * 状态机已下沉到 @dustnote/client-core 的 createModeStore（审计 ARCH-002
 * 后续项：三端各写一份且已分叉）。这里只保留平台差异：Taro storage 同步读写。
 */

import { useStore } from 'zustand';
import { createModeStore, MODE_STORAGE_KEY, type ModeStoreState } from '@dustnote/client-core';
import Taro from '@tarojs/taro';
import type { ModeState } from '@dustnote/shared';

const STORAGE_KEY = MODE_STORAGE_KEY;

/** 同步读取（Taro.getStorageSync 在 weapp / h5 均提供同步版本） */
function load(): Partial<ModeState> | null {
  try {
    const raw = Taro.getStorageSync(STORAGE_KEY);
    if (!raw) return null;
    return typeof raw === 'string'
      ? (JSON.parse(raw) as Partial<ModeState>)
      : (raw as Partial<ModeState>);
  } catch {
    /* 存储损坏或不可用，忽略 */
    return null;
  }
}

/** 异步持久化（Taro.setStorage 返回 Promise，写入失败不阻塞 UI） */
function save(state: ModeState): void {
  void Promise.resolve(Taro.setStorage({ key: STORAGE_KEY, data: JSON.stringify(state) })).catch(
    () => undefined
  );
}

export const modeStore = createModeStore({ load, save });

/**
 * zustand 同形门面：既可作为 hook 使用（useModeStore(sel)），也保留
 * getState/setState/subscribe（非 React 上下文，如 lib/repository 工厂、
 * 自动锁屏计时器）。这样原有全部调用点无需改动。
 */
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

/** 获取当前模式（非 React 上下文使用，如 lib/repository.ts 工厂） */
export function getCurrentMode(): ModeState {
  const s = modeStore.getState();
  return { mode: s.mode, serverUrl: s.serverUrl, initialized: s.initialized };
}
