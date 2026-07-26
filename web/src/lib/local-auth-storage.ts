/**
 * 单机模式本地鉴权存储（v2.0.0）
 *
 * 持久化 LocalAuthBlob 和 LocalLockoutState 到 localStorage：
 * - 'dustnote_local_auth_blob'：单机模式鉴权 blob（passwordHash + salts + 双重包装的 masterKey）
 * - 'dustnote_lockout_state'：客户端锁定状态（失败计数 + 锁定截止时间）
 *
 * 安全说明：
 * - blob 中不含 masterKey 明文，只有包装后的密文
 * - 拿到 blob 无法解密笔记（需要 passwordDerivedKey 或 recoveryKey）
 * - lockoutState 用于防暴力破解（连续 6 次失败锁定 15 分钟）
 */

import type { LocalAuthBlob, LocalLockoutState } from '@dustnote/shared';
import {
  INITIAL_LOCKOUT_STATE,
  deserializeLocalAuthBlob,
  serializeLocalAuthBlob,
} from '@dustnote/shared';

const BLOB_KEY = 'dustnote_local_auth_blob';
const LOCKOUT_KEY = 'dustnote_lockout_state';

// ========== LocalAuthBlob ==========

/** 加载本地鉴权 blob；不存在时返回 null */
export function loadLocalAuthBlob(): LocalAuthBlob | null {
  try {
    const raw = localStorage.getItem(BLOB_KEY);
    if (!raw) return null;
    return deserializeLocalAuthBlob(raw);
  } catch {
    return null;
  }
}

/** 保存本地鉴权 blob */
export function saveLocalAuthBlob(blob: LocalAuthBlob): void {
  localStorage.setItem(BLOB_KEY, serializeLocalAuthBlob(blob));
}

/** 清除本地鉴权 blob（注销或切换模式时） */
export function clearLocalAuthBlob(): void {
  localStorage.removeItem(BLOB_KEY);
}

/** 检查是否已设置主密码（单机模式） */
export function hasLocalAuth(): boolean {
  return localStorage.getItem(BLOB_KEY) !== null;
}

// ========== LocalLockoutState ==========

/** 加载锁定状态；不存在时返回初始状态 */
export function loadLockoutState(): LocalLockoutState {
  try {
    const raw = localStorage.getItem(LOCKOUT_KEY);
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
export function saveLockoutState(state: LocalLockoutState): void {
  localStorage.setItem(LOCKOUT_KEY, JSON.stringify(state));
}

/** 清除锁定状态 */
export function clearLockoutState(): void {
  localStorage.removeItem(LOCKOUT_KEY);
}
