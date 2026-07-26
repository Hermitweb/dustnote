/**
 * 单机模式本地鉴权存储（v2.0.0）
 *
 * 持久化 LocalAuthBlob 和 LocalLockoutState 到 AsyncStorage：
 * - 'dustnote_local_auth_blob'：单机模式鉴权 blob（passwordHash + salts + 双重包装的 masterKey）
 * - 'dustnote_lockout_state'：客户端锁定状态（失败计数 + 锁定截止时间）
 *
 * 实现说明：
 * - 项目当前未安装 react-native-mmkv，故沿用 AsyncStorage（与 mobile/src/api.ts、theme.ts 一致）
 * - 所有 API 都是 async（AsyncStorage 是异步的）；调用方需 await
 *
 * 安全说明：
 * - blob 中不含 masterKey 明文，只有包装后的密文
 * - 拿到 blob 无法解密笔记（需要 passwordDerivedKey 或 recoveryKey）
 * - lockoutState 用于防暴力破解（连续 6 次失败锁定 15 分钟）
 */

import type { LocalAuthBlob } from '@dustnote/shared';
import {
  INITIAL_LOCKOUT_STATE,
  type LocalLockoutState,
  deserializeLocalAuthBlob,
  serializeLocalAuthBlob,
} from '@dustnote/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BLOB_KEY = 'dustnote_local_auth_blob';
const LOCKOUT_KEY = 'dustnote_lockout_state';

// ========== LocalAuthBlob ==========

/** 加载本地鉴权 blob；不存在或损坏时返回 null */
export async function loadLocalAuthBlob(): Promise<LocalAuthBlob | null> {
  try {
    const raw = await AsyncStorage.getItem(BLOB_KEY);
    if (!raw) return null;
    return deserializeLocalAuthBlob(raw);
  } catch {
    return null;
  }
}

/** 保存本地鉴权 blob */
export async function saveLocalAuthBlob(blob: LocalAuthBlob): Promise<void> {
  await AsyncStorage.setItem(BLOB_KEY, serializeLocalAuthBlob(blob));
}

/** 清除本地鉴权 blob（注销或切换模式时） */
export async function clearLocalAuthBlob(): Promise<void> {
  await AsyncStorage.removeItem(BLOB_KEY);
}

/** 检查是否已设置主密码（单机模式） */
export async function hasLocalAuth(): Promise<boolean> {
  return (await AsyncStorage.getItem(BLOB_KEY)) !== null;
}

// ========== LocalLockoutState ==========

/** 加载锁定状态；不存在或损坏时返回初始状态 */
export async function loadLockoutState(): Promise<LocalLockoutState> {
  try {
    const raw = await AsyncStorage.getItem(LOCKOUT_KEY);
    if (!raw) return { ...INITIAL_LOCKOUT_STATE };
    const parsed = JSON.parse(raw) as Partial<LocalLockoutState>;
    return {
      failedAttempts: parsed.failedAttempts ?? 0,
      lockedUntil: parsed.lockedUntil ?? 0,
    };
  } catch {
    return { ...INITIAL_LOCKOUT_STATE };
  }
}

/** 保存锁定状态 */
export async function saveLockoutState(state: LocalLockoutState): Promise<void> {
  await AsyncStorage.setItem(LOCKOUT_KEY, JSON.stringify(state));
}

/** 清除锁定状态 */
export async function clearLockoutState(): Promise<void> {
  await AsyncStorage.removeItem(LOCKOUT_KEY);
}
