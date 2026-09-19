/**
 * 冲突裁决 store（安卓端薄封装）
 *
 * 实现已下沉到 @dustnote/client-core 的 createConflictStore（审计 ARCH-002
 * 后续项）。本端此前的实现会把 pendingConflicts 持久化到 AsyncStorage——
 * 其中 local/server/merged 含**解密后的笔记明文**，与 E2EE「明文不落盘」
 * 约束冲突（AsyncStorage 未加密），已随下沉移除；冲突改为内存态，未裁决项
 * 在应用重启后丢弃（服务端数据不受影响，重进页面会重新产生）。
 */

import { useStore } from 'zustand';
import { createConflictStore } from '@dustnote/client-core';
import { api } from '../api';
import { useAuthStore } from './auth';

export type { PendingConflict } from '@dustnote/client-core';

/** 非 React 上下文用（离线队列回调等）：conflictStore.getState().enqueueConflict(...) */
export const conflictStore = createConflictStore({
  getApi: () => api,
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
