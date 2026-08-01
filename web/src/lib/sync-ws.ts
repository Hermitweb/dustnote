/**
 * WebSocket 客户端：监听服务端 note_changed / share_changed 广播
 * 详见 update-strategy.md §6.3
 */

import { getDeviceId } from './device';
import { useStore } from './store';
import { useModeStore } from './mode-store';

const APP_VERSION = __APP_VERSION__;
let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;

function wsUrl(): string {
  // 桌面端 webview origin 是 tauri://localhost，不能用 location.host；
  // 必须从 mode-store 读用户配置的 serverUrl 拼绝对地址，否则桌面端联机模式 WS 永远连不上。
  const { serverUrl } = useModeStore.getState();
  const base = serverUrl ? serverUrl.replace(/\/+$/, '') : `${location.protocol}//${location.host}`;
  const proto = base.startsWith('https') ? 'wss:' : base.startsWith('http') ? 'ws:' : (location.protocol === 'https:' ? 'wss:' : 'ws:');
  return `${proto}//${base.replace(/^https?:\/\//, '')}/api/v1/sync/ws`;
}

function getAccessToken(): string | null {
  return useStore.getState().accessToken;
}

export function startSyncWs(): void {
  stopSyncWs();

  const token = getAccessToken();
  if (!token) return;

  const url = `${wsUrl()}?token=${encodeURIComponent(token)}&v=${APP_VERSION}&platform=web&deviceId=${getDeviceId()}`;

  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error('WS 创建失败', err);
    scheduleReconnect();
    return;
  }

  ws.addEventListener('open', () => {
    // 连接已恢复：先重放离线队列，再订阅 + 拉取最新
    void useStore
      .getState()
      .flushQueue()
      .finally(() => {
        ws?.send(JSON.stringify({ type: 'subscribe', channels: ['notes', 'shares'] }));
        useStore
          .getState()
          .loadAll()
          .catch(() => {});
        // 标记为在线
        useStore.getState().setOnline(true);
      });
  });

  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as {
        type: string;
        noteId?: string;
        shareId?: string;
        op?: string;
      };
      if (msg.type === 'note_changed' && msg.noteId) {
        // 触发重新拉取该笔记
        useStore
          .getState()
          .loadAll()
          .catch(() => {});
      } else if (msg.type === 'share_changed' && msg.shareId) {
        useStore
          .getState()
          .loadAll()
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
  });

  ws.addEventListener('close', () => {
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    ws?.close();
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (getAccessToken()) startSyncWs();
  }, 5_000);
}

export function stopSyncWs(): void {
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}
