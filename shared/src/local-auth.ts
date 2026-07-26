/**
 * 单机模式本地鉴权工具（v2.0.0）
 *
 * 设计意图：
 * - 单机模式无服务器，主密码验证完全本地化（无 JWT）
 * - 复用 shared/src/crypto.ts 的 Argon2id + AES-256-GCM + recovery code 机制
 * - 本地存储 LocalAuthBlob，包含 passwordHash + salts + 双重包装的 masterKey
 * - 客户端锁定：连续 6 次失败后锁定 15 分钟（本地记录）
 *
 * 安全模型（关键改进：masterKey 随机生成，不从密码派生）：
 * - masterKey = randomBytes(32) —— 随机生成，setup 时一次性创建
 * - passwordHash = Argon2id(password, masterSalt) —— 仅用于校验密码（离线爆破成本高 m=64MB t=3 p=4）
 * - passwordDerivedKey = deriveMasterKey(password, clientMasterSalt) —— 用于解封 masterKey
 * - passwordWrappedMasterKey = AES-GCM(passwordDerivedKey, masterKey) —— 日常 unlock 用
 * - recoveryKey = deriveRecoveryKey(recoveryCode, recoverySalt) —— 用于 recover 时解封 masterKey
 * - wrappedMasterKey = AES-GCM(recoveryKey, masterKey) —— recover 用
 * - recoveryHash = Argon2id(recoveryCode, recoverySalt, 弱参数) —— 仅用于校验恢复码
 *
 * 与联机模式的差异：
 * - 联机模式：masterKey = deriveMasterKey(password, clientMasterSalt)，从密码派生；recover 后 masterKey 改变，旧笔记无法解密
 * - 单机模式：masterKey 随机生成，recover 后 masterKey 保留，旧笔记可继续解密 ✅
 * - 两者使用相同的 crypto.ts 原语，密文格式一致
 */

import {
  deriveKey,
  deriveMasterKey,
  deriveRecoveryKey,
  generateRecoveryCode,
  wrapMasterKey,
  unwrapMasterKey,
  randomBytes,
  toBase64,
  fromBase64,
  constantTimeEqual,
  KDF_PARAMS,
  KDF_VERSION,
  type Ciphertext,
} from './crypto.js';
import type { LocalAuthBlob } from './types.js';

// ========== 客户端锁定常量 ==========

/** 连续失败次数上限 */
export const LOCAL_LOCKOUT_THRESHOLD = 6;
/** 锁定时长（毫秒）：15 分钟 */
export const LOCAL_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/** 客户端锁定状态（持久化到本地存储） */
export interface LocalLockoutState {
  /** 连续失败次数 */
  failedAttempts: number;
  /** 锁定截止时间戳（ms），0 = 未锁定 */
  lockedUntil: number;
}

export const INITIAL_LOCKOUT_STATE: LocalLockoutState = {
  failedAttempts: 0,
  lockedUntil: 0,
};

// ========== 主密码 setup ==========

export interface SetupLocalAuthResult {
  /** 持久化到本地的鉴权 blob */
  blob: LocalAuthBlob;
  /** 随机生成的 masterKey（仅在 setup 时返回一次，调用方需立即使用或缓存） */
  masterKey: Uint8Array;
  /** 6 位恢复码（仅在此返回，后续无法再次获取） */
  recoveryCode: string;
}

/**
 * 单机模式首次设置主密码
 *
 * 流程：
 * 1. 生成 masterKey = randomBytes(32)（随机，与密码无关）
 * 2. 生成 masterSalt（16B）+ clientMasterSalt（16B）+ recoverySalt（16B）
 * 3. passwordHash = Argon2id(password, masterSalt)（仅用于校验）
 * 4. passwordDerivedKey = deriveMasterKey(password, clientMasterSalt)
 * 5. passwordWrappedMasterKey = AES-GCM(passwordDerivedKey, masterKey)
 * 6. recoveryCode = generateRecoveryCode() (6 位)
 * 7. recoveryKey = deriveRecoveryKey(recoveryCode, recoverySalt)
 * 8. recoveryHash = Argon2id(recoveryCode, recoverySalt, 弱参数)（仅用于校验）
 * 9. wrappedMasterKey = AES-GCM(recoveryKey, masterKey)
 *
 * @param password 用户主密码（>= 8 字符）
 */
export async function setupLocalAuth(password: string): Promise<SetupLocalAuthResult> {
  if (password.length < 8) {
    throw new Error('主密码至少 8 字符');
  }

  // 1. 随机 masterKey（不依赖密码，recover 时可保留）
  const masterKey = randomBytes(32);

  const masterSalt = randomBytes(16);
  const clientMasterSalt = randomBytes(16);
  const recoverySalt = randomBytes(16);

  // 2. passwordHash（仅用于 unlock 时校验密码）
  const passwordHashBytes = deriveKey(password, masterSalt, KDF_PARAMS);
  const passwordHash = toBase64(passwordHashBytes);

  // 3. passwordDerivedKey + passwordWrappedMasterKey（日常 unlock 用）
  const passwordDerivedKey = await deriveMasterKey(password, clientMasterSalt);
  const passwordWrappedMasterKey = await wrapMasterKey(passwordDerivedKey, masterKey);

  // 4. recoveryCode + recoveryKey + wrappedMasterKey（recover 用）
  const recoveryCode = generateRecoveryCode();
  const recoveryKey = deriveRecoveryKey(recoveryCode, recoverySalt);
  const recoveryHashBytes = deriveKey(recoveryCode, recoverySalt, {
    m: 16 * 1024,
    t: 2,
    p: 2,
    dkLen: 32,
  });
  const recoveryHash = toBase64(recoveryHashBytes);
  const wrappedMasterKey = await wrapMasterKey(recoveryKey, masterKey);

  const blob: LocalAuthBlob = {
    passwordHash,
    masterSalt: toBase64(masterSalt),
    clientMasterSalt: toBase64(clientMasterSalt),
    wrappedMasterKey: JSON.stringify(wrappedMasterKey),
    passwordWrappedMasterKey: JSON.stringify(passwordWrappedMasterKey),
    recoveryHash,
    recoverySalt: toBase64(recoverySalt),
    kdfVersion: KDF_VERSION,
    createdAt: new Date().toISOString(),
  };

  return { blob, masterKey, recoveryCode };
}

// ========== 主密码 unlock ==========

export interface UnlockLocalAuthResult {
  /** 是否验证通过 */
  success: boolean;
  /** 验证通过时返回 masterKey，失败时返回 null */
  masterKey: Uint8Array | null;
}

/**
 * 单机模式解锁：验证主密码并解封 masterKey
 *
 * 流程：
 * 1. passwordHash' = Argon2id(password, blob.masterSalt)
 * 2. constantTimeEqual(passwordHash', blob.passwordHash)
 * 3. 若匹配，passwordDerivedKey = deriveMasterKey(password, blob.clientMasterSalt)
 * 4. masterKey = unwrapMasterKey(passwordDerivedKey, blob.passwordWrappedMasterKey)
 *
 * 注意：调用方负责维护 LocalLockoutState（失败计数 + 锁定）
 */
export async function unlockLocalAuth(
  password: string,
  blob: LocalAuthBlob
): Promise<UnlockLocalAuthResult> {
  const masterSalt = fromBase64(blob.masterSalt);
  const passwordHashBytes = deriveKey(password, masterSalt, KDF_PARAMS);
  const storedHashBytes = fromBase64(blob.passwordHash);

  if (!constantTimeEqual(passwordHashBytes, storedHashBytes)) {
    return { success: false, masterKey: null };
  }

  // 密码正确，解封 masterKey
  const clientMasterSalt = fromBase64(blob.clientMasterSalt);
  const passwordDerivedKey = await deriveMasterKey(password, clientMasterSalt);
  const passwordWrapped = JSON.parse(blob.passwordWrappedMasterKey) as Ciphertext;
  const masterKey = await unwrapMasterKey(passwordDerivedKey, passwordWrapped);

  return { success: true, masterKey };
}

// ========== 恢复码 recover ==========

export interface RecoverLocalAuthResult {
  /** 是否验证通过 */
  success: boolean;
  /** 新的鉴权 blob（持久化覆盖旧的）；masterKey 保持不变，已有笔记可继续解密 */
  blob: LocalAuthBlob | null;
  /** 原始的 masterKey（不变，与 setup 时一致） */
  masterKey: Uint8Array | null;
  /** 新生成的恢复码（旧恢复码已失效） */
  recoveryCode: string | null;
}

/**
 * 单机模式恢复：用恢复码重置主密码（保留原 masterKey）
 *
 * 流程：
 * 1. recoveryHash' = Argon2id(recoveryCode, blob.recoverySalt)
 * 2. constantTimeEqual(recoveryHash', blob.recoveryHash)
 * 3. 若匹配，recoveryKey = deriveRecoveryKey(recoveryCode, blob.recoverySalt)
 * 4. originalMasterKey = unwrapMasterKey(recoveryKey, blob.wrappedMasterKey)
 * 5. 用新密码生成新 salts + 新 passwordDerivedKey + 新 recoveryCode
 * 6. 重新包装 originalMasterKey：
 *    - passwordWrappedMasterKey = AES-GCM(newPasswordDerivedKey, originalMasterKey)
 *    - wrappedMasterKey = AES-GCM(newRecoveryKey, originalMasterKey)
 * 7. 返回新 blob + 原 masterKey + 新 recoveryCode
 *
 * 关键：masterKey 不变，已有笔记可继续解密 ✅
 *
 * @param recoveryCode 用户输入的 6 位恢复码
 * @param newPassword 新主密码（>= 8 字符）
 * @param oldBlob 旧的 LocalAuthBlob
 */
export async function recoverLocalAuth(
  recoveryCode: string,
  newPassword: string,
  oldBlob: LocalAuthBlob
): Promise<RecoverLocalAuthResult> {
  if (newPassword.length < 8) {
    throw new Error('新主密码至少 8 字符');
  }

  // 1. 校验恢复码
  const recoverySalt = fromBase64(oldBlob.recoverySalt);
  const recoveryHashBytes = deriveKey(recoveryCode, recoverySalt, {
    m: 16 * 1024,
    t: 2,
    p: 2,
    dkLen: 32,
  });
  const storedRecoveryHashBytes = fromBase64(oldBlob.recoveryHash);

  if (!constantTimeEqual(recoveryHashBytes, storedRecoveryHashBytes)) {
    return { success: false, blob: null, masterKey: null, recoveryCode: null };
  }

  // 2. 用 recoveryKey 解封原始 masterKey（保留不变）
  const recoveryKey = deriveRecoveryKey(recoveryCode, recoverySalt);
  const oldWrapped = JSON.parse(oldBlob.wrappedMasterKey) as Ciphertext;
  const originalMasterKey = await unwrapMasterKey(recoveryKey, oldWrapped);

  // 3. 用新密码生成新 salts + 新 passwordDerivedKey
  const newMasterSalt = randomBytes(16);
  const newClientMasterSalt = randomBytes(16);
  const newRecoverySalt = randomBytes(16);

  const newPasswordHashBytes = deriveKey(newPassword, newMasterSalt, KDF_PARAMS);
  const newPasswordHash = toBase64(newPasswordHashBytes);
  const newPasswordDerivedKey = await deriveMasterKey(newPassword, newClientMasterSalt);

  // 4. 重新包装 originalMasterKey
  const newPasswordWrappedMasterKey = await wrapMasterKey(
    newPasswordDerivedKey,
    originalMasterKey
  );

  // 5. 生成新 recoveryCode + 新 recoveryKey
  const newRecoveryCode = generateRecoveryCode();
  const newRecoveryKey = deriveRecoveryKey(newRecoveryCode, newRecoverySalt);
  const newRecoveryHashBytes = deriveKey(newRecoveryCode, newRecoverySalt, {
    m: 16 * 1024,
    t: 2,
    p: 2,
    dkLen: 32,
  });
  const newRecoveryHash = toBase64(newRecoveryHashBytes);
  const newWrappedMasterKey = await wrapMasterKey(newRecoveryKey, originalMasterKey);

  // 6. 构造新 blob
  const newBlob: LocalAuthBlob = {
    passwordHash: newPasswordHash,
    masterSalt: toBase64(newMasterSalt),
    clientMasterSalt: toBase64(newClientMasterSalt),
    wrappedMasterKey: JSON.stringify(newWrappedMasterKey),
    passwordWrappedMasterKey: JSON.stringify(newPasswordWrappedMasterKey),
    recoveryHash: newRecoveryHash,
    recoverySalt: toBase64(newRecoverySalt),
    kdfVersion: KDF_VERSION,
    createdAt: new Date().toISOString(),
  };

  return {
    success: true,
    blob: newBlob,
    masterKey: originalMasterKey,
    recoveryCode: newRecoveryCode,
  };
}

// ========== 客户端锁定辅助函数 ==========

/**
 * 检查当前是否处于锁定状态
 */
export function isLocked(state: LocalLockoutState, now = Date.now()): boolean {
  return state.lockedUntil > now;
}

/**
 * 记录一次失败尝试，返回新的锁定状态
 */
export function recordFailedAttempt(
  state: LocalLockoutState,
  threshold = LOCAL_LOCKOUT_THRESHOLD,
  durationMs = LOCAL_LOCKOUT_DURATION_MS,
  now = Date.now()
): LocalLockoutState {
  const failedAttempts = state.failedAttempts + 1;
  if (failedAttempts >= threshold) {
    return {
      failedAttempts: 0, // 锁定后重置计数
      lockedUntil: now + durationMs,
    };
  }
  return { ...state, failedAttempts };
}

/**
 * 记录一次成功尝试，重置失败计数
 */
export function recordSuccessfulAttempt(): LocalLockoutState {
  return { ...INITIAL_LOCKOUT_STATE };
}

/**
 * 计算剩余锁定时间（毫秒）
 */
export function remainingLockoutMs(state: LocalLockoutState, now = Date.now()): number {
  if (!isLocked(state, now)) return 0;
  return state.lockedUntil - now;
}

// ========== 序列化 / 反序列化 ==========

/**
 * 序列化 LocalAuthBlob 为 JSON 字符串（持久化到本地存储）
 */
export function serializeLocalAuthBlob(blob: LocalAuthBlob): string {
  return JSON.stringify(blob);
}

/**
 * 反序列化 LocalAuthBlob
 */
export function deserializeLocalAuthBlob(json: string): LocalAuthBlob {
  const parsed = JSON.parse(json) as LocalAuthBlob;
  if (
    typeof parsed.passwordHash !== 'string' ||
    typeof parsed.masterSalt !== 'string' ||
    typeof parsed.clientMasterSalt !== 'string' ||
    typeof parsed.wrappedMasterKey !== 'string' ||
    typeof parsed.passwordWrappedMasterKey !== 'string' ||
    typeof parsed.recoveryHash !== 'string' ||
    typeof parsed.recoverySalt !== 'string'
  ) {
    throw new Error('Invalid LocalAuthBlob format');
  }
  return parsed;
}
