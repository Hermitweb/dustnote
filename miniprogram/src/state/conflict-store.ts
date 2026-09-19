/**
 * 冲突裁决 store（小程序端薄封装）
 *
 * 实现已下沉到 @dustnote/client-core 的 createConflictStore（审计 ARCH-002
 * 后续项）。本端原本就只存内存（明文不落盘），语义被采纳为统一行为。
 */

import { useStore } from 'zustand';
import { createConflictStore } from '@dustnote/client-core';
import { getApi, useAuthStore } from './auth';

export type { PendingConflict } from '@dustnote/client-core';

/** 非 React 上下文用（离线队列回调等）：conflictStore.getState().enqueueConflict(...) */
export const conflictStore = createConflictStore({
  getApi,
  getAuth: () => {
    const { masterKey, userId } = useAuthStore.getState();
    return { masterKey, userId };
  },
});

/** 冲突 store 的 zustand 同形门面（hook + getState/setState/subscribe） */
type ConflictStoreHook = {
  <T>(selector: (s: ReturnType<typeof conflictStore.getState>) => T): T;
  getState: typeof conflictStore.getState;
  setState: typeof conflictStore.setState;
  subscribe: typeof conflictStore.subscribe;
};

export const useConflictStore = (<T>(
  selector: (s: ReturnType<typeof conflictStore.getState>) => T
): T => useStore(conflictStore, selector)) as ConflictStoreHook;
useConflictStore.getState = conflictStore.getState;
useConflictStore.setState = conflictStore.setState;
useConflictStore.subscribe = conflictStore.subscribe;
