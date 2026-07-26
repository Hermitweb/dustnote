/**
 * 单机模式本地鉴权存储（v2.0.0）
 *
 * 持久化 LocalAuthBlob 和 LocalLockoutState 到 Taro.setStorage：
 * - 'dustnote_local_auth_blob'：单机模式鉴权 blob
 *   （passwordHash + salts + 双重包装的 masterKey）
 * - 'dustnote_lockout_state'：客户端锁定状态（失败计数 + 锁定截止时间）
 *
 * 安全说明：
 * - blob 中不含 masterKey 明文，只有包装后的密文
 * - 拿到 blob 无法解密笔记（需要 passwordDerivedKey 或 recoveryKey）
 * - lockoutState 用于防暴力破解（连续 6 次失败锁定 15 分钟）
 *
 * 注意：与 web 端 local-auth-storage.ts 的差异：
 * - web 端用 localStorage（同步 API）
 * - 小程序端用 Taro.setStorage（异步），提供同步 + 异步两套 API：
 *   - 模块加载 / 初始化时用同步版本（getStorageSync / setStorageSync）
 *   - 页面交互时可用异步版本（setStorage / getStorage）
 */

import Taro from '@tarojs/taro';
import type { LocalAuthBlob, LocalLockoutState } from '@dustnote/shared';
import {
  INITIAL_LOCKOUT_STATE,
  deserializeLocalAuthBlob,
  serializeLocalAuthBlob,
} from '@dustnote/shared';

const BLOB_KEY = 'dustnote_local_auth_blob';
const LOCKOUT_KEY = 'dustnote_lockout_state';

// ========== LocalAuthBlob ==========

/**
 * 同步加载本地鉴权 blob；不存在时返回 null
 *
 * 用于应用启动时的初始化检查（如 useLaunch 中判断是否已设置主密码）。
 */
export function loadLocalAuthBlobSync(): LocalAuthBlob | null {
  try {
    const raw = Taro.getStorageSync(BLOB_KEY);
    if (!raw) return null;
    const json = typeof raw === 'string' ? raw : JSON.stringify(raw);
    return deserializeLocalAuthBlob(json);
  } catch {
    return null;
  }
}

/**
 * 异步加载本地鉴权 blob；不存在时返回 null
 *
 * 用于页面交互场景（避免阻塞 UI）。
 */
export async function loadLocalAuthBlob(): Promise<LocalAuthBlob | null> {
  try {
    const res = await Taro.getStorage({ key: BLOB_KEY });
    if (!res.data) return null;
    const json = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    return deserializeLocalAuthBlob(json);
  } catch {
    return null;
  }
}

/**
 * 异步保存本地鉴权 blob
 */
export async function saveLocalAuthBlob(blob: LocalAuthBlob): Promise<void> {
  await Taro.setStorage({ key: BLOB_KEY, data: serializeLocalAuthBlob(blob) });
}

/**
 * 同步保存本地鉴权 blob
 *
 * 仅在 setup 流程末尾的紧急场景使用（避免页面跳转时数据未落盘）。
 */
export function saveLocalAuthBlobSync(blob: LocalAuthBlob): void {
  Taro.setStorageSync(BLOB_KEY, serializeLocalAuthBlob(blob));
}

/**
 * 清除本地鉴权 blob（注销或切换模式时）
 */
export async function clearLocalAuthBlob(): Promise<void> {
  try {
    await Taro.removeStorage({ key: BLOB_KEY });
  } catch {
    /* key 不存在时忽略 */
  }
}

/**
 * 同步检查是否已设置主密码（单机模式）
 *
 * 用于应用启动时的路由决策（首次 → setup，已有 → unlock）。
 */
export function hasLocalAuthSync(): boolean {
  try {
    return Taro.getStorageSync(BLOB_KEY) !== '';
  } catch {
    return false;
  }
}

// ========== LocalLockoutState ==========

/**
 * 同步加载锁定状态；不存在时返回初始状态
 */
export function loadLockoutStateSync(): LocalLockoutState {
  try {
    const raw = Taro.getStorageSync(LOCKOUT_KEY);
    if (!raw) return { ...INITIAL_LOCKOUT_STATE };
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<LocalLockoutState>;
    return {
      failedAttempts: parsed.failedAttempts ?? 0,
      lockedUntil: parsed.lockedUntil ?? 0,
    };
  } catch {
    return { ...INITIAL_LOCKOUT_STATE };
  }
}

/**
 * 异步加载锁定状态
 */
export async function loadLockoutState(): Promise<LocalLockoutState> {
  try {
    const res = await Taro.getStorage({ key: LOCKOUT_KEY });
    if (!res.data) return { ...INITIAL_LOCKOUT_STATE };
    const parsed =
      typeof res.data === 'string'
        ? (JSON.parse(res.data) as Partial<LocalLockoutState>)
        : (res.data as Partial<LocalLockoutState>);
    return {
      failedAttempts: parsed.failedAttempts ?? 0,
      lockedUntil: parsed.lockedUntil ?? 0,
    };
  } catch {
    return { ...INITIAL_LOCKOUT_STATE };
  }
}

/**
 * 异步保存锁定状态
 */
export async function saveLockoutState(state: LocalLockoutState): Promise<void> {
  await Taro.setStorage({ key: LOCKOUT_KEY, data: JSON.stringify(state) });
}

/**
 * 同步保存锁定状态
 *
 * 用于 unlock 失败后立即持久化（避免崩溃丢失计数）。
 */
export function saveLockoutStateSync(state: LocalLockoutState): void {
  Taro.setStorageSync(LOCKOUT_KEY, JSON.stringify(state));
}

/**
 * 清除锁定状态
 */
export async function clearLockoutState(): Promise<void> {
  try {
    await Taro.removeStorage({ key: LOCKOUT_KEY });
  } catch {
    /* key 不存在时忽略 */
  }
}
