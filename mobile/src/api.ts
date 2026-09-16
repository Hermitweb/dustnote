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
import * as Keychain from 'react-native-keychain';
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
// M10：refresh token 是 30 天有效的会话凭证,从 AsyncStorage（明文、可被
// 备份提取）迁到 Keystore 加固的 Keychain。与 masterKey 缓存同一存储策略,
// 不挂生物访问控制（刷新是静默行为,不能每次弹指纹）
const REFRESH_KEYCHAIN_SERVICE = 'com.dustnote.refresh';

export function setAccessToken(token: string | null): void {
  currentToken = token;
  if (token) AsyncStorage.setItem('dustnote_access_token', token).catch(() => undefined);
  else AsyncStorage.removeItem('dustnote_access_token').catch(() => undefined);
}

/**
 * M8：refresh token 的「权威存储」标记。
 * Keychain 写失败降级到 AsyncStorage 后,若读路径仍优先 Keychain,里面残留的
 * 上一枚（已轮换作废）RT 会长期遮蔽 AS 里的新鲜 RT → 每次刷新 401 → 清 RT
 * → 反复踢回解锁页。标记存在时读路径只认 AsyncStorage。
 */
const RT_BACKEND_KEY = 'dustnote_refresh_backend';

/** 自管 refresh token（RN 无法依赖 HTTP-only cookie,服务端 /auth/refresh 兼容 X-Refresh-Token header） */
export async function setRefreshToken(token: string | null): Promise<void> {
  // M-C：Keychain 写失败必须降级到 AsyncStorage 而不是向上抛——此前写路径无
  // 降级（读路径有）,Keychain 不可用的设备上每次密码解锁/刷新都会整体失败
  if (token) {
    try {
      await Keychain.setGenericPassword('refresh', token, {
        service: REFRESH_KEYCHAIN_SERVICE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      // Keychain 成为权威：清掉 AS 副本与降级标记
      await AsyncStorage.removeItem(REFRESH_TOKEN_KEY).catch(() => undefined);
      await AsyncStorage.removeItem(RT_BACKEND_KEY).catch(() => undefined);
      return;
    } catch {
      /* Keychain 不可用：落 AS 兜底 */
    }
    try {
      await AsyncStorage.setItem(REFRESH_TOKEN_KEY, token);
      await AsyncStorage.setItem(RT_BACKEND_KEY, 'as');
      // 尽力清掉 Keychain 里的陈旧值（失败也不影响：标记已让读路径忽略它）
      await Keychain.resetGenericPassword({ service: REFRESH_KEYCHAIN_SERVICE }).catch(
        () => undefined
      );
    } catch {
      /* 两处都不可用：静默放弃（下次刷新失败会走 transient/rejected 分类） */
    }
    return;
  }

  // 清除：两个存储都要清干净。Keychain reset 失败时留标记,让读路径忽略
  // 其中残留的已吊销 token（否则每次请求都白跑一次刷新）
  let keychainCleared = true;
  try {
    await Keychain.resetGenericPassword({ service: REFRESH_KEYCHAIN_SERVICE });
  } catch {
    keychainCleared = false;
  }
  await AsyncStorage.removeItem(REFRESH_TOKEN_KEY).catch(() => undefined);
  if (keychainCleared) {
    await AsyncStorage.removeItem(RT_BACKEND_KEY).catch(() => undefined);
  } else {
    await AsyncStorage.setItem(RT_BACKEND_KEY, 'as').catch(() => undefined);
  }
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
  // M8：降级标记存在时 AsyncStorage 是权威——不读 Keychain,避免其中残留的
  // 已轮换 token 遮蔽新鲜值
  const backend = await AsyncStorage.getItem(RT_BACKEND_KEY).catch(() => null);
  if (backend === 'as') {
    return AsyncStorage.getItem(REFRESH_TOKEN_KEY);
  }
  // 先读 Keychain（M10 后的正式位置）;读不到再回退 AsyncStorage 旧位置并
  // 迁移——升级用户的首个刷新周期完成无感搬迁
  try {
    const creds = await Keychain.getGenericPassword({ service: REFRESH_KEYCHAIN_SERVICE });
    if (creds && creds.password) return creds.password;
  } catch {
    /* Keychain 不可用（模拟器/特殊 ROM）时回退 AsyncStorage */
  }
  const legacy = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
  if (legacy) {
    try {
      await Keychain.setGenericPassword('refresh', legacy, {
        service: REFRESH_KEYCHAIN_SERVICE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      /* 迁移失败：标记 AS 为权威,下次直接读 AS（不再反复尝试迁移） */
      await AsyncStorage.setItem(RT_BACKEND_KEY, 'as').catch(() => undefined);
    }
  }
  return legacy;
}

let refreshInFlight: Promise<RefreshOutcome> | null = null;

/**
 * 用 refresh token 静默换新 access token（服务端轮换 refresh token）。
 * 并发 401 只触发一次刷新（refreshInFlight 去重）。
 */
/**
 * 刷新结果的三态（H1）：调用方必须区分「终态失效」与「瞬时失败」——
 * 此前统一返回 boolean,把网络抖动/5xx/429 也当成会话吊销,导致弱网下
 * 用户被强制锁屏（且 refresh 与 unlock 共用限流桶,可能连锁 429 硬锁死）。
 * - ok：拿到新 access token
 * - rejected：服务端判定过期/吊销（RT 已清）→ 该回解锁页
 * - transient：网络/超时/5xx/429 → RT 保留,原样上抛让页面显示网络错误
 */
export type RefreshOutcome = 'ok' | 'rejected' | 'transient';

export async function refreshAccessTokenSilently(): Promise<RefreshOutcome> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const refresh = await getRefreshToken();
      // 没有 RT = 无从续签,属终态（调用方据此回解锁页）
      if (!refresh) return 'rejected' as const;
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
      return 'ok' as const;
    } catch (err) {
      // 分类处理:仅服务端判定过期/吊销(401/403)才清 refresh token 并视为终态;
      // 网络抖动/超时/5xx/429 保留 token,判为瞬时失败——一次断网不该把用户
      // 踢回密码登录（H1）
      const status = (err as { status?: number })?.status;
      if (status !== 401 && status !== 403) return 'transient' as const;
      await setRefreshToken(null);
      return 'rejected' as const;
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
    // H-E：排除 /auth/ 自身（unlock 密码错误也是 401,不能触发会话过期接管）
    const status = (err as { status?: number }).status;
    if (status === 401 && !path.startsWith('/auth/')) {
      // H1：三态判定——只有「终态失效」才交回 auth store 锁屏；瞬时失败
      // （网络/超时/5xx/429）原样上抛,由页面显示网络错误。此前把任何
      // false 都当吊销,弱网下会误锁屏,且 refresh 与 unlock 共用限流桶
      // 可能连锁 429 把用户硬锁 15 分钟。
      const outcome = await refreshAccessTokenSilently();
      if (outcome === 'ok') {
        return await (await fresh()).request(method, path, body, init);
      }
      if (outcome === 'rejected') {
        // 终态：无 RT 或服务端判定过期/吊销（RT 已清）。生物解锁提速
        // （c3e98df）后不再有「回解锁页」的前置安全网,若无人接管,用户会
        // 困在已解锁界面每次操作都失败——交回 auth store 处理（H-E）
        try {
          onAuthExpired?.();
        } catch {
          /* 回调异常不得替换掉原始 API 错误 */
        }
      }
    }
    throw err;
  }
};
(api as unknown as { request: RequestMethod }).request = requestImpl;

/**
 * 401 终态处理器（H-E）：由 auth store 在模块加载时注入。
 * 触发条件：请求 401 且刷新无法恢复（无 RT / RT 过期或设备被吊销）。
 * 用回调注入而非直接 import auth-store,避免 api ↔ auth 循环依赖。
 */
let onAuthExpired: (() => void) | null = null;
export function setAuthExpiredHandler(fn: (() => void) | null): void {
  onAuthExpired = fn;
}
