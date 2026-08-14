/**
 * 单机模式本地鉴权工具（v2 协议）
 *
 * 设计意图：
 * - 单机模式无服务器，主密码验证完全本地化（无 JWT）
 * - 复用 shared/src/crypto.ts 的 Argon2id + AES-256-GCM + recovery code 机制
 * - 本地存储 LocalAuthBlob，包含 salts + authKey 哈希 + 双重包装的 masterKey
 * - 客户端锁定：连续 6 次失败后锁定 15 分钟（本地记录）
 *
 * 安全模型（v2 协议）：
 * - masterKey = generateMasterKey() —— 随机生成，setup 时一次性创建，终生不变
 * - { kek, authKey } = deriveSecrets(password, pwSalt) —— 一次 Argon2id 同时派生
 *   - kek 用于包装/解封 masterKey（绝不离开客户端）
 *   - authKey 的 base64 存为 passwordHash，仅用于校验密码
 * - passwordWrappedMasterKey = wrapKey(passwordKek, masterKey) —— 日常 unlock 用
 * - 同理，恢复码派生 recoveryKek + recoveryAuthKey，包装同一把 masterKey
 * - recover 后 masterKey 保留，旧笔记可继续解密 ✅
 *
 * 与联机模式的差异：
 * - 联机模式：authKey 上传服务端做身份校验，masterKey 由服务端密文返回
 * - 单机模式：authKey 本地存为 hash 做校验，masterKey 本地解封
 * - 两者使用相同的 crypto.ts 原语，密文格式一致
 *
 * 兼容性：kdfVersion=1 的旧 blob 无法解锁，需提示用户重新 setup
 */

import {
  deriveSecrets,
  generateMasterKey,
  generateRecoveryCode,
  normalizeRecoveryCode,
  isValidRecoveryCode,
  wrapKey,
  unwrapKey,
  randomBytes,
  toBase64,
  fromBase64,
  constantTimeEqual,
  KDF_PARAMS,
  KDF_VERSION,
  type Ciphertext,
  type KdfParams,
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
  /** 10 位恢复码（仅在此返回一次，后续无法再次获取） */
  recoveryCode: string;
}

/**
 * 单机模式首次设置主密码
 *
 * 流程：
 * 1. 生成 masterKey = generateMasterKey()（随机，与密码无关）
 * 2. 生成 pwSalt（16B）+ rcSalt（16B）
 * 3. { passwordKek, passwordAuthKey } = deriveSecrets(password, pwSalt)
 * 4. passwordWrappedMasterKey = wrapKey(passwordKek, masterKey)
 * 5. passwordHash = toBase64(passwordAuthKey)（仅用于校验）
 * 6. recoveryCode = generateRecoveryCode()（10 位 Crockford Base32）
 * 7. normalizedCode = normalizeRecoveryCode(recoveryCode)
 * 8. { recoveryKek, recoveryAuthKey } = deriveSecrets(normalizedCode, rcSalt)
 * 9. wrappedMasterKey = wrapKey(recoveryKek, masterKey)
 * 10. recoveryHash = toBase64(recoveryAuthKey)（仅用于校验）
 *
 * @param password 用户主密码（>= 8 字符）
 */
export async function setupLocalAuth(
  password: string,
  params: KdfParams = KDF_PARAMS
): Promise<SetupLocalAuthResult> {
  if (password.length < 8) {
    throw new Error('主密码至少 8 字符');
  }

  // 1. 随机 masterKey（不依赖密码，recover 时可保留）
  const masterKey = generateMasterKey();

  const pwSalt = randomBytes(16);
  const rcSalt = randomBytes(16);

  // 2. 密码派生 KEK + authKey（一次 Argon2id）
  const { kek: passwordKek, authKey: passwordAuthKey } = await deriveSecrets(password, pwSalt, params);
  const passwordWrappedMasterKey = await wrapKey(passwordKek, masterKey);
  const passwordHash = toBase64(passwordAuthKey);

  // 3. 恢复码派生 recoveryKek + recoveryAuthKey
  const recoveryCode = generateRecoveryCode();
  const normalizedCode = normalizeRecoveryCode(recoveryCode);
  const { kek: recoveryKek, authKey: recoveryAuthKey } = await deriveSecrets(
    normalizedCode,
    rcSalt,
    params
  );
  const wrappedMasterKey = await wrapKey(recoveryKek, masterKey);
  const recoveryHash = toBase64(recoveryAuthKey);

  const blob: LocalAuthBlob = {
    pwSalt: toBase64(pwSalt),
    rcSalt: toBase64(rcSalt),
    passwordHash,
    passwordWrappedMasterKey: JSON.stringify(passwordWrappedMasterKey),
    wrappedMasterKey: JSON.stringify(wrappedMasterKey),
    recoveryHash,
    kdfVersion: KDF_VERSION,
    // §17.4.1：记录实际 KDF 参数（含 algorithm / iterations），解锁时按 blob 存储的参数派生
    kdfParams: {
      algorithm: params.algorithm ?? 'argon2id',
      m: params.m,
      t: params.t,
      p: params.p,
      ...(params.iterations !== undefined ? { iterations: params.iterations } : {}),
      dkLen: params.dkLen,
    },
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

/** v1 旧 blob 无法解锁，调用方应提示用户重新 setup */
export class LegacyAuthBlobError extends Error {
  constructor(message = '旧版鉴权数据（v1）无法解锁，请重新设置主密码') {
    super(message);
    this.name = 'LegacyAuthBlobError';
  }
}

/**
 * 单机模式解锁：验证主密码并解封 masterKey
 *
 * 流程：
 * 1. 检查 kdfVersion（v1 抛 LegacyAuthBlobError）
 * 2. { passwordKek, passwordAuthKey } = deriveSecrets(password, blob.pwSalt)
 * 3. constantTimeEqual(passwordAuthKey, blob.passwordHash)
 * 4. 若匹配，masterKey = unwrapKey(passwordKek, blob.passwordWrappedMasterKey)
 *
 * 注意：调用方负责维护 LocalLockoutState（失败计数 + 锁定）
 */
export async function unlockLocalAuth(
  password: string,
  blob: LocalAuthBlob,
  params: KdfParams = KDF_PARAMS
): Promise<UnlockLocalAuthResult> {
  if (blob.kdfVersion !== KDF_VERSION) {
    throw new LegacyAuthBlobError();
  }

  // §17.4.1：优先使用 blob 记录的实际 KDF 参数（支持未来参数演进）
  const usedParams = blob.kdfParams ?? params;
  const pwSalt = fromBase64(blob.pwSalt);
  const { kek: passwordKek, authKey: passwordAuthKey } = await deriveSecrets(
    password,
    pwSalt,
    usedParams
  );

  if (!constantTimeEqual(passwordAuthKey, fromBase64(blob.passwordHash))) {
    return { success: false, masterKey: null };
  }

  // 密码正确，解封 masterKey
  const passwordWrapped = JSON.parse(blob.passwordWrappedMasterKey) as Ciphertext;
  const masterKey = await unwrapKey(passwordKek, passwordWrapped);

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
 * 1. 检查 kdfVersion（v1 抛 LegacyAuthBlobError）
 * 2. normalizedCode = normalizeRecoveryCode(recoveryCode)
 * 3. { recoveryKek, recoveryAuthKey } = deriveSecrets(normalizedCode, blob.rcSalt)
 * 4. constantTimeEqual(recoveryAuthKey, blob.recoveryHash)
 * 5. 若匹配，originalMasterKey = unwrapKey(recoveryKek, blob.wrappedMasterKey)
 * 6. 用新密码生成新 pwSalt + 新 recoveryCode + 新 rcSalt
 * 7. 重新包装 originalMasterKey：
 *    - passwordWrappedMasterKey = wrapKey(newPasswordKek, originalMasterKey)
 *    - wrappedMasterKey = wrapKey(newRecoveryKek, originalMasterKey)
 * 8. 返回新 blob + 原 masterKey + 新 recoveryCode
 *
 * 关键：masterKey 不变，已有笔记可继续解密 ✅
 *
 * @param recoveryCode 用户输入的 10 位恢复码
 * @param newPassword 新主密码（>= 8 字符）
 * @param oldBlob 旧的 LocalAuthBlob
 */
export async function recoverLocalAuth(
  recoveryCode: string,
  newPassword: string,
  oldBlob: LocalAuthBlob,
  params: KdfParams = KDF_PARAMS
): Promise<RecoverLocalAuthResult> {
  if (newPassword.length < 8) {
    throw new Error('新主密码至少 8 字符');
  }

  if (oldBlob.kdfVersion !== KDF_VERSION) {
    throw new LegacyAuthBlobError();
  }

  // 1. 规范化恢复码并校验
  const normalizedCode = normalizeRecoveryCode(recoveryCode);
  if (!isValidRecoveryCode(normalizedCode)) {
    return { success: false, blob: null, masterKey: null, recoveryCode: null };
  }

  // §17.4.1：优先使用旧 blob 记录的实际 KDF 参数
  const usedParams = oldBlob.kdfParams ?? params;
  const rcSalt = fromBase64(oldBlob.rcSalt);
  const { kek: recoveryKek, authKey: recoveryAuthKey } = await deriveSecrets(
    normalizedCode,
    rcSalt,
    usedParams
  );

  if (!constantTimeEqual(recoveryAuthKey, fromBase64(oldBlob.recoveryHash))) {
    return { success: false, blob: null, masterKey: null, recoveryCode: null };
  }

  // 2. 用 recoveryKek 解封原始 masterKey（保留不变）
  const oldWrapped = JSON.parse(oldBlob.wrappedMasterKey) as Ciphertext;
  const originalMasterKey = await unwrapKey(recoveryKek, oldWrapped);

  // 3. 用新密码生成新 pwSalt + 派生新 KEK + authKey
  const newPwSalt = randomBytes(16);
  const { kek: newPasswordKek, authKey: newPasswordAuthKey } = await deriveSecrets(
    newPassword,
    newPwSalt,
    params
  );
  const newPasswordWrappedMasterKey = await wrapKey(newPasswordKek, originalMasterKey);
  const newPasswordHash = toBase64(newPasswordAuthKey);

  // 4. 生成新 recoveryCode + 新 rcSalt + 派生新 recoveryKek + recoveryAuthKey
  const newRecoveryCode = generateRecoveryCode();
  const newNormalizedCode = normalizeRecoveryCode(newRecoveryCode);
  const newRcSalt = randomBytes(16);
  const { kek: newRecoveryKek, authKey: newRecoveryAuthKey } = await deriveSecrets(
    newNormalizedCode,
    newRcSalt,
    params
  );
  const newWrappedMasterKey = await wrapKey(newRecoveryKek, originalMasterKey);
  const newRecoveryHash = toBase64(newRecoveryAuthKey);

  // 5. 构造新 blob（沿用当前 KDF 参数）
  const newBlob: LocalAuthBlob = {
    pwSalt: toBase64(newPwSalt),
    rcSalt: toBase64(newRcSalt),
    passwordHash: newPasswordHash,
    passwordWrappedMasterKey: JSON.stringify(newPasswordWrappedMasterKey),
    wrappedMasterKey: JSON.stringify(newWrappedMasterKey),
    recoveryHash: newRecoveryHash,
    kdfVersion: KDF_VERSION,
    kdfParams: {
      algorithm: usedParams.algorithm ?? 'argon2id',
      m: usedParams.m,
      t: usedParams.t,
      p: usedParams.p,
      ...(usedParams.iterations !== undefined ? { iterations: usedParams.iterations } : {}),
      dkLen: usedParams.dkLen,
    },
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
    typeof parsed.pwSalt !== 'string' ||
    typeof parsed.rcSalt !== 'string' ||
    typeof parsed.passwordHash !== 'string' ||
    typeof parsed.passwordWrappedMasterKey !== 'string' ||
    typeof parsed.wrappedMasterKey !== 'string' ||
    typeof parsed.recoveryHash !== 'string'
  ) {
    throw new Error('Invalid LocalAuthBlob format');
  }
  return parsed;
}
