/**
 * 移动端 API 客户端
 *
 * 直接基于 fetch + @dustnote/shared 的 ApiClient
 * 默认 baseUrl 在真机调试时通过 adb reverse 转发到开发机 localhost:3210
 * 生产环境可改为 https://api.dustnote.app/v1
 */

import { ApiClient, type ClientChannel, type ClientPlatform } from '@dustnote/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';

const APP_VERSION = '0.1.0';

let deviceId: string | null = null;

async function getDeviceId(): Promise<string> {
  if (deviceId) return deviceId;
  const stored = await AsyncStorage.getItem('dustnote_device_id');
  if (stored) {
    deviceId = stored;
    return stored;
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  await AsyncStorage.setItem('dustnote_device_id', id);
  deviceId = id;
  return id;
}

let currentToken: string | null = null;

export function setAccessToken(token: string | null): void {
  currentToken = token;
  if (token) AsyncStorage.setItem('dustnote_access_token', token).catch(() => undefined);
  else AsyncStorage.removeItem('dustnote_access_token').catch(() => undefined);
}

export const api = new ApiClient({
  baseUrl: 'http://localhost:3210/api/v1',
  clientVersion: APP_VERSION,
  platform: 'android' as ClientPlatform,
  channel: 'stable' as ClientChannel,
  deviceId: '__pending__', // 实际请求时由 interceptor 注入
  accessToken: currentToken ?? undefined,
});

// 拦截器：注入动态 deviceId 与 token
(api as any).request = async function (
  method: string,
  path: string,
  body?: unknown,
  init?: RequestInit
) {
  const dId = await getDeviceId();
  const token = currentToken ?? (await AsyncStorage.getItem('dustnote_access_token')) ?? undefined;
  // 重新构造 client（带正确 deviceId + token）
  const fresh = new ApiClient({
    baseUrl: 'http://localhost:3210/api/v1',
    clientVersion: APP_VERSION,
    platform: 'android' as ClientPlatform,
    channel: 'stable' as ClientChannel,
    deviceId: dId,
    accessToken: token,
  });
  return fresh.request(method, path, body, init);
};
