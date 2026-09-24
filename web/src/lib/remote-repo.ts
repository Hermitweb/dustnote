/**
 * Web 端联机模式 DataRepository（平台薄封装）
 *
 * 实现已下沉到 @dustnote/client-core 的 RemoteRepository（审计 ARCH-002：
 * 三端各写一份已漂移，收敛为单一实现）。这里只保留 web 的平台差异：
 * 用 mode-store 的 serverUrl + device.ts 的 deviceId 构造 ApiClient，
 * 并在每次调用时读取最新 accessToken。
 *
 * 注意：此 Repository 处理的是密文行（ciphertext 是 JSON 字符串），
 * 加解密在 store 层完成。
 */

import type { Ciphertext } from '@dustnote/shared';
import { ApiClient } from '@dustnote/shared';
import { RemoteRepository as CoreRemoteRepository } from '@dustnote/client-core';
import { getDeviceId } from './device';
import { getCurrentMode } from './mode-store';

const APP_VERSION = __APP_VERSION__;

/**
 * 构造 ApiClient（从 mode-store 读取 serverUrl）
 * - serverUrl 为 null 时走同源 /api/v1（开发环境）
 * - serverUrl 不为 null 时拼接 /api/v1
 */
function createApiClient(accessToken: string | null): ApiClient {
  const { serverUrl } = getCurrentMode();
  const baseUrl = serverUrl ? `${serverUrl.replace(/\/+$/, '')}/api/v1` : '/api/v1';
  return new ApiClient({
    baseUrl,
    clientVersion: APP_VERSION,
    platform: 'web',
    channel: 'stable',
    deviceId: getDeviceId(),
    accessToken: accessToken ?? undefined,
    // 30s 超时（对齐 mobile，2026-09-24 审计同步）：CRUD 请求不能无限挂起
    timeoutMs: 30_000,
  });
}

export class RemoteRepository extends CoreRemoteRepository {
  constructor(getAccessToken: () => string | null) {
    // 每次调用时新建 ApiClient：accessToken 会在会话中轮换，必须读最新值
    super(() => createApiClient(getAccessToken()), { appVersion: APP_VERSION });
  }
}

/**
 * 加载 wrappedMasterKey（联机模式专用，从 /auth/me 获取）
 */
export async function loadWrappedMasterKey(accessToken: string | null): Promise<Ciphertext | null> {
  const a = createApiClient(accessToken);
  try {
    const r = await a.get<{ wrappedMasterKey: Ciphertext }>('/auth/me');
    return r.wrappedMasterKey;
  } catch {
    return null;
  }
}
