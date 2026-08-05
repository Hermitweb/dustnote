/**
 * 移动端 API 客户端
 *
 * 直接基于 fetch + @dustnote/shared 的 ApiClient
 *
 * baseUrl 动态解析：
 * - 联机模式：从 mode-store 读取 serverUrl（用户在设置页配置）
 * - 单机模式 / 未配置：回退到 DEFAULT_BASE_URL（默认 localhost:3210，真机调试用 adb reverse 转发）
 *
 * 注意：单机模式下不应调用此客户端（应使用 local-repo），但保留回退能力以兼容现有页面，
 * 批次6 路由改造后会按模式分流到对应 repository。
 */

import { ApiClient, type ClientChannel, type ClientPlatform } from '@dustnote/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_BASE_URL, resolveBaseUrl } from './lib/mode-store';

// 与 package.json 同步（全端版本统一，见 release 流程）
const APP_VERSION = '2.5.0';

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
  baseUrl: DEFAULT_BASE_URL,
  clientVersion: APP_VERSION,
  platform: 'android' as ClientPlatform,
  channel: 'stable' as ClientChannel,
  deviceId: '__pending__', // 实际请求时由 interceptor 注入
  accessToken: currentToken ?? undefined,
});

// 拦截器：每次请求重新构造 client，注入动态 deviceId + token + baseUrl
// baseUrl 从 mode-store 读取（联机模式下用户配置的 serverUrl）。
// 直接覆写实例的 request 方法（get/post/patch/delete 内部都走 this.request），
// 用显式类型代替 as any。
type RequestMethod = ApiClient['request'];
const requestImpl: RequestMethod = async function (
  this: ApiClient,
  method: string,
  path: string,
  body?: unknown,
  init?: RequestInit
) {
  const dId = await getDeviceId();
  const token = currentToken ?? (await AsyncStorage.getItem('dustnote_access_token')) ?? undefined;
  // 重新构造 client（带最新 baseUrl + deviceId + token）
  const fresh = new ApiClient({
    baseUrl: resolveBaseUrl(),
    clientVersion: APP_VERSION,
    platform: 'android' as ClientPlatform,
    channel: 'stable' as ClientChannel,
    deviceId: dId,
    accessToken: token,
  });
  return fresh.request(method, path, body, init);
};
(api as unknown as { request: RequestMethod }).request = requestImpl;
