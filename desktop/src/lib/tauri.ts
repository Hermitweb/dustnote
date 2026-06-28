/**
 * Tauri 环境检测与桥接封装
 */

import { ApiClient } from '@dustnote/shared';

const APP_VERSION = __APP_VERSION__;

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function getApiBase(): string {
  // v1 桌面端使用本地服务：打包时内置 server.exe
  // 开发期通过 vite proxy 转发到 localhost:3210
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
  let id = localStorage.getItem('mn_device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('mn_device_id', id);
  }
  return id;
}
