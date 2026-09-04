/**
 * WebSocket 客户端:监听服务端 note_changed / share_changed 广播
 * (移植自 web/src/lib/sync-ws.ts,Taro.connectSocket 实现)
 *
 * - token 走子协议 ["dustnote", <token>],不进 URL(避免反代日志泄露会话)
 * - 断线指数退避 5s→10s→…→60s 封顶
 * - note_changed/share_changed → 防抖 300ms 后广播 dustnote:data-changed
 *   (index/folders/trash 已监听该事件自动刷新)
 * - Taro.connectSocket 在部分基础库返回 Promise<SocketTask>,两种形态都兼容
 */

import Taro from '@tarojs/taro';
import { useModeStore } from './mode-store';
import { useAuthStore, APP_VERSION } from '../state/auth';
import { flushOfflineQueue } from './offline-queue';

let task: Taro.SocketTask | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;
let loadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const LOAD_DEBOUNCE_MS = 300;

function getDeviceId(): string {
  try {
    return Taro.getStorageSync('dustnote_device_id') || '';
  } catch {
    return '';
  }
}

function scheduleReload(): void {
  if (loadDebounceTimer !== null) return;
  loadDebounceTimer = setTimeout(() => {
    loadDebounceTimer = null;
    try {
      Taro.eventCenter.trigger('dustnote:data-changed', { source: 'ws' });
    } catch {
      /* ignore */
    }
  }, LOAD_DEBOUNCE_MS);
}

function wsUrl(): string {
  const { serverUrl } = useModeStore.getState();
  const base = (serverUrl ?? '').replace(/\/+$/, '');
  const proto = base.startsWith('https') ? 'wss:' : 'ws:';
  return `${proto}//${base.replace(/^https?:\/\//, '')}/api/v1/sync/ws?v=${APP_VERSION}&platform=miniprogram&deviceId=${getDeviceId()}`;
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (useAuthStore.getState().accessToken) startSyncWs();
  }, delay);
}

function bindTask(t: Taro.SocketTask): void {
  t.onOpen(() => {
    reconnectAttempts = 0;
    void flushOfflineQueue().finally(() => {
      try {
        t.send({ data: JSON.stringify({ type: 'subscribe', channels: ['notes', 'shares'] }) });
      } catch {
        /* ignore */
      }
      scheduleReload();
    });
  });

  t.onMessage((res) => {
    try {
      const msg = JSON.parse(typeof res.data === 'string' ? res.data : '') as {
        type?: string;
        noteId?: string;
        shareId?: string;
      };
      if (
        (msg.type === 'note_changed' && msg.noteId) ||
        (msg.type === 'share_changed' && msg.shareId)
      ) {
        scheduleReload();
      }
    } catch {
      /* ignore */
    }
  });

  t.onClose(() => scheduleReconnect());
  t.onError(() => {
    try {
      t.close({});
    } catch {
      /* ignore */
    }
  });
}

export function startSyncWs(): void {
  stopSyncWs();
  const token = useAuthStore.getState().accessToken;
  const { serverUrl } = useModeStore.getState();
  if (!token || !serverUrl) return;

  let t: Taro.SocketTask | null = null;
  try {
    const ret = Taro.connectSocket({
      url: `${wsUrl()}&t=${Date.now()}`,
      protocols: ['dustnote', token],
      fail: () => scheduleReconnect(),
    }) as unknown as Taro.SocketTask | Promise<Taro.SocketTask>;
    if (ret && typeof (ret as Promise<unknown>).then === 'function') {
      // Promise 形态:异步拿 task
      void (ret as Promise<Taro.SocketTask>).then((sock) => {
        task = sock;
        if (task) bindTask(task);
      });
      return;
    }
    t = ret as Taro.SocketTask;
  } catch {
    scheduleReconnect();
    return;
  }
  if (!t) {
    scheduleReconnect();
    return;
  }
  task = t;
  bindTask(t);
}

export function stopSyncWs(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (task) {
    try {
      task.close({});
    } catch {
      /* ignore */
    }
    task = null;
  }
}
