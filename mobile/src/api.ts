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
import { APP_VERSION } from './lib/version';

let deviceId: string | null = null;

/** 取设备 ID（持久化；首装生成）。导出供"测试连接"等独立客户端复用 */
export async function getDeviceId(): Promise<string> {
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

const REFRESH_TOKEN_KEY = 'dustnote_refresh_token';

export function setAccessToken(token: string | null): void {
  currentToken = token;
  if (token) AsyncStorage.setItem('dustnote_access_token', token).catch(() => undefined);
  else AsyncStorage.removeItem('dustnote_access_token').catch(() => undefined);
}

/** 自管 refresh token（RN 无法依赖 HTTP-only cookie,服务端 /auth/refresh 兼容 X-Refresh-Token header） */
export async function setRefreshToken(token: string | null): Promise<void> {
  if (token) await AsyncStorage.setItem(REFRESH_TOKEN_KEY, token);
  else await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
}

/**
 * 裸 fetch 用的客户端标识头（X-Client-*）。
 * 服务端 version-check 中间件要求这些头（缺失返回 400 missing_client_headers）；
 * 走 ApiClient 的请求由拦截器自动注入，绕过 ApiClient 的直接 fetch 需手动带上。
 */
export async function buildClientHeaders(
  extra?: Record<string, string>
): Promise<Record<string, string>> {
  const dId = await getDeviceId();
  return {
    'X-Client-Version': APP_VERSION,
    'X-Client-Platform': 'android' as ClientPlatform,
    'X-Client-Channel': 'stable' as ClientChannel,
    'X-Client-Device-Id': dId,
    ...(extra ?? {}),
  };
}

async function getRefreshToken(): Promise<string | null> {
  return AsyncStorage.getItem(REFRESH_TOKEN_KEY);
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * 用 refresh token 静默换新 access token（服务端轮换 refresh token）。
 * 并发 401 只触发一次刷新（refreshInFlight 去重）；刷新失败返回 false
 * （调用方把 401 原样抛出，由上层引导重新登录）。
 */
export async function refreshAccessTokenSilently(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const refresh = await getRefreshToken();
      if (!refresh) return false;
      const dId = await getDeviceId();
      const client = new ApiClient({
        baseUrl: resolveBaseUrl(),
        clientVersion: APP_VERSION,
        platform: 'android' as ClientPlatform,
        channel: 'stable' as ClientChannel,
        deviceId: dId,
        timeoutMs: 30_000,
      });
      const r = await client.request<{ accessToken: string; refreshToken?: string }>(
        'POST',
        '/auth/refresh',
        undefined,
        { headers: { 'X-Refresh-Token': refresh } }
      );
      setAccessToken(r.accessToken);
      if (r.refreshToken) await setRefreshToken(r.refreshToken);
      return true;
    } catch {
      // refresh 失败（过期/吊销）：清掉失效的 refresh token,上层引导重新登录
      await setRefreshToken(null);
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export const api = new ApiClient({
  baseUrl: DEFAULT_BASE_URL,
  clientVersion: APP_VERSION,
  platform: 'android' as ClientPlatform,
  channel: 'stable' as ClientChannel,
  deviceId: '__pending__', // 实际请求时由 interceptor 注入
  accessToken: currentToken ?? undefined,
  // 移动网络抖动时 fetch 可能长时间无响应：不设超时会让解锁等界面永久卡死
  //（真机实测：unlock 前置的 /auth/status 探测挂死，UI 停在"正在派生密钥"）。
  timeoutMs: 30_000,
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
  const fresh = async (): Promise<ApiClient> => {
    const dId = await getDeviceId();
    const token = currentToken ?? (await AsyncStorage.getItem('dustnote_access_token')) ?? undefined;
    // 每次请求重新构造 client（带最新 baseUrl + deviceId + token + 超时）
    return new ApiClient({
      baseUrl: resolveBaseUrl(),
      clientVersion: APP_VERSION,
      platform: 'android' as ClientPlatform,
      channel: 'stable' as ClientChannel,
      deviceId: dId,
      accessToken: token,
      timeoutMs: 30_000,
    });
  };
  try {
    return await (await fresh()).request(method, path, body, init);
  } catch (err) {
    // access token 过期（15 分钟 TTL）且本地有 refresh token：静默续签后重放一次。
    // 锁屏超 15 分钟后生物解锁复用旧 token 的场景即由此自愈（v2.5.18）。
    const status = (err as { status?: number }).status;
    if (status === 401 && (await getRefreshToken())) {
      if (await refreshAccessTokenSilently()) {
        return await (await fresh()).request(method, path, body, init);
      }
    }
    throw err;
  }
};
(api as unknown as { request: RequestMethod }).request = requestImpl;
