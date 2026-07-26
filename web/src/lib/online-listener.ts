/**
 * online/offline 事件监听
 *
 * 浏览器在网络恢复时会派发 `online` 事件。
 * 我们据此更新 store.isOnline 并触发队列重放。
 *
 * 注意：navigator.onLine 在某些场景（如禁用网卡但保留 Wi-Fi）可能误报，
 *      因此仅作为「尽快重试」的触发器，最终一致性由 WS 重连 + loadAll 保证。
 */

import { useStore } from './store';

let installed = false;

function handleOnline(): void {
  useStore.getState().setOnline(true);
  void useStore.getState().flushQueue();
}

function handleOffline(): void {
  useStore.getState().setOnline(false);
}

/** 注册事件监听（幂等，重复调用安全） */
export function installOnlineListener(): void {
  if (installed) return;
  if (typeof window === 'undefined') return;

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // 初始化时同步一次状态
  useStore.getState().setOnline(navigator.onLine);

  installed = true;
}

/** 卸载监听（仅测试或显式注销时调用） */
export function uninstallOnlineListener(): void {
  if (!installed) return;
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);
  installed = false;
}
