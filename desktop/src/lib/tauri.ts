/**
 * Tauri 环境检测与桥接封装
 */

import { ApiClient } from '@dustnote/shared';

const APP_VERSION = __APP_VERSION__;

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function getApiBase(): string {
  // 桌面端联机模式：连接用户在模式设置中配置的 serverUrl（见 web/src/lib/mode-store.ts），
  // 此处返回开发期默认地址（vite dev proxy 转发到 localhost:3210）。
  // 注意：v1 桌面端不内置 server.exe——内置本地 server 为 v1.1 规划项。
  if (isTauri()) {
    return 'http://localhost:3210/api/v1';
  }
  return '/api/v1';
}

export function getPlatformHeaders(): Record<string, string> {
  return {
    'X-Client-Platform': 'desktop',
    'X-Client-Channel': 'stable',
    'X-Client-Version': APP_VERSION,
  };
}

export function createApiClient(accessToken?: string): ApiClient {
  return new ApiClient({
    baseUrl: getApiBase(),
    clientVersion: APP_VERSION,
    platform: 'desktop',
    channel: 'stable',
    deviceId: getDeviceId(),
    accessToken,
  });
}

export function getDeviceId(): string {
  let id = localStorage.getItem('dustnote_device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('dustnote_device_id', id);
  }
  return id;
}
