import { describe, it, expect } from 'vitest';
import {
  setupLocalAuth,
  unlockLocalAuth,
  recoverLocalAuth,
  isLocked,
  recordFailedAttempt,
  recordSuccessfulAttempt,
  remainingLockoutMs,
  serializeLocalAuthBlob,
  deserializeLocalAuthBlob,
  LegacyAuthBlobError,
  INITIAL_LOCKOUT_STATE,
  LOCAL_LOCKOUT_THRESHOLD,
  LOCAL_LOCKOUT_DURATION_MS,
  type LocalLockoutState,
} from '../src/local-auth';
import type { LocalAuthBlob } from '../src/types';

const GOOD_PASSWORD = 'correct-horse-battery-staple';
/** 弱 KDF 参数，加速测试（协议逻辑与 KDF 强度无关） */
const FAST_KDF = { m: 64, t: 1, p: 1, dkLen: 32 };
/** v2 恢复码格式：10 位 Crockford Base32，XXXXX-XXXXX 分组 */
const RECOVERY_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

describe('local-auth: setupLocalAuth', () => {
  it('produces a blob, masterKey, and 10-char Crockford recovery code', async () => {
    const result = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    expect(result.blob).toBeDefined();
    expect(result.masterKey).toBeInstanceOf(Uint8Array);
    expect(result.masterKey.length).toBe(32);
    expect(result.recoveryCode).toMatch(RECOVERY_CODE_RE);
  });

  it('rejects passwords shorter than 8 chars', async () => {
    await expect(setupLocalAuth('short', FAST_KDF)).rejects.toThrow(/至少 8 字符/);
  });

  it('generates unique salts per setup', async () => {
    const a = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    const b = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    expect(a.blob.pwSalt).not.toBe(b.blob.pwSalt);
    expect(a.blob.rcSalt).not.toBe(b.blob.rcSalt);
    expect(a.recoveryCode).not.toBe(b.recoveryCode);
  });

  it('blob contains all required fields', async () => {
    const { blob } = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    expect(typeof blob.pwSalt).toBe('string');
    expect(typeof blob.rcSalt).toBe('string');
    expect(typeof blob.passwordHash).toBe('string');
    expect(typeof blob.wrappedMasterKey).toBe('string');
    expect(typeof blob.passwordWrappedMasterKey).toBe('string');
    expect(typeof blob.recoveryHash).toBe('string');
    expect(typeof blob.kdfVersion).toBe('number');
    expect(typeof blob.createdAt).toBe('string');
    expect(blob.kdfVersion).toBe(2);
    // wrappedMasterKey 必须是合法的 Ciphertext JSON
    const wrapped = JSON.parse(blob.wrappedMasterKey);
    expect(wrapped).toHaveProperty('v');
    expect(wrapped).toHaveProperty('k');
    expect(wrapped).toHaveProperty('n');
    expect(wrapped).toHaveProperty('c');
    // passwordWrappedMasterKey 必须是合法的 Ciphertext JSON
    const pwWrapped = JSON.parse(blob.passwordWrappedMasterKey);
    expect(pwWrapped).toHaveProperty('v');
    expect(pwWrapped).toHaveProperty('n');
    expect(pwWrapped).toHaveProperty('c');
  });
});

describe('local-auth: unlockLocalAuth', () => {
  it('succeeds with correct password and returns masterKey', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    const result = await unlockLocalAuth(GOOD_PASSWORD, setup.blob, FAST_KDF);
    expect(result.success).toBe(true);
    expect(result.masterKey).toBeInstanceOf(Uint8Array);
    expect(result.masterKey!.length).toBe(32);
    // masterKey 必须与 setup 时返回的一致
    expect(Array.from(result.masterKey!)).toEqual(Array.from(setup.masterKey));
  });

  it('fails with wrong password', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    const result = await unlockLocalAuth('wrong-password-12345', setup.blob, FAST_KDF);
    expect(result.success).toBe(false);
    expect(result.masterKey).toBeNull();
  });

  it('produces same masterKey across multiple unlocks', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    const r1 = await unlockLocalAuth(GOOD_PASSWORD, setup.blob, FAST_KDF);
    const r2 = await unlockLocalAuth(GOOD_PASSWORD, setup.blob, FAST_KDF);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(Array.from(r1.masterKey!)).toEqual(Array.from(r2.masterKey!));
  });

  it('throws LegacyAuthBlobError for v1 blobs', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    const v1Blob = { ...setup.blob, kdfVersion: 1 } as LocalAuthBlob;
    await expect(unlockLocalAuth(GOOD_PASSWORD, v1Blob, FAST_KDF)).rejects.toThrow(
      LegacyAuthBlobError
    );
  });
});

describe('local-auth: recoverLocalAuth', () => {
  it('succeeds with correct recovery code and produces new blob/masterKey/recoveryCode', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    const result = await recoverLocalAuth(
      setup.recoveryCode,
      'new-password-12345',
      setup.blob,
      FAST_KDF
    );
    expect(result.success).toBe(true);
    expect(result.blob).not.toBeNull();
    expect(result.masterKey).toBeInstanceOf(Uint8Array);
    expect(result.recoveryCode).toMatch(RECOVERY_CODE_RE);
    // 新恢复码必须与旧的不同
    expect(result.recoveryCode).not.toBe(setup.recoveryCode);
    // 新 salts 必须与旧的不同
    expect(result.blob!.pwSalt).not.toBe(setup.blob.pwSalt);
  });

  it('fails with wrong recovery code', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    // 格式合法但内容错误的恢复码
    const result = await recoverLocalAuth(
      'AAAAA-AAAAA',
      'new-password-12345',
      setup.blob,
      FAST_KDF
    );
    expect(result.success).toBe(false);
    expect(result.blob).toBeNull();
    expect(result.masterKey).toBeNull();
    expect(result.recoveryCode).toBeNull();
  });

  it('new password can unlock the new blob', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    const recovered = await recoverLocalAuth(
      setup.recoveryCode,
      'new-password-12345',
      setup.blob,
      FAST_KDF
    );
    expect(recovered.success).toBe(true);
    const unlockResult = await unlockLocalAuth('new-password-12345', recovered.blob!, FAST_KDF);
    expect(unlockResult.success).toBe(true);
    // 新 masterKey 必须与 recover 返回的一致
    expect(Array.from(unlockResult.masterKey!)).toEqual(Array.from(recovered.masterKey!));
  });

  it('preserves the original masterKey after recovery (existing notes remain decryptable)', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    const recovered = await recoverLocalAuth(
      setup.recoveryCode,
      'new-password-12345',
      setup.blob,
      FAST_KDF
    );
    expect(recovered.success).toBe(true);
    // 关键：recover 后 masterKey 必须与 setup 时一致（已有笔记可继续解密）
    expect(Array.from(recovered.masterKey!)).toEqual(Array.from(setup.masterKey));
  });

  it('old password cannot unlock the new blob', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    const recovered = await recoverLocalAuth(
      setup.recoveryCode,
      'new-password-12345',
      setup.blob,
      FAST_KDF
    );
    expect(recovered.success).toBe(true);
    const unlockResult = await unlockLocalAuth(GOOD_PASSWORD, recovered.blob!, FAST_KDF);
    expect(unlockResult.success).toBe(false);
  });

  it('rejects new passwords shorter than 8 chars', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    await expect(
      recoverLocalAuth(setup.recoveryCode, 'short', setup.blob, FAST_KDF)
    ).rejects.toThrow(/至少 8 字符/);
  });

  it('accepts recovery code without dash (normalizeRecoveryCode)', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    // 去掉分隔符也能通过
    const noDash = setup.recoveryCode.replace('-', '');
    const result = await recoverLocalAuth(noDash, 'new-password-12345', setup.blob, FAST_KDF);
    expect(result.success).toBe(true);
  });
});

describe('local-auth: lockout state', () => {
  it('initial state is not locked', () => {
    expect(isLocked(INITIAL_LOCKOUT_STATE)).toBe(false);
    expect(remainingLockoutMs(INITIAL_LOCKOUT_STATE)).toBe(0);
  });

  it('records failed attempts without locking until threshold', () => {
    let state: LocalLockoutState = INITIAL_LOCKOUT_STATE;
    for (let i = 1; i < LOCAL_LOCKOUT_THRESHOLD; i++) {
      state = recordFailedAttempt(state);
      expect(state.failedAttempts).toBe(i);
      expect(state.lockedUntil).toBe(0);
      expect(isLocked(state)).toBe(false);
    }
  });

  it('locks after threshold failures', () => {
    let state: LocalLockoutState = INITIAL_LOCKOUT_STATE;
    for (let i = 0; i < LOCAL_LOCKOUT_THRESHOLD; i++) {
      state = recordFailedAttempt(state, LOCAL_LOCKOUT_THRESHOLD, LOCAL_LOCKOUT_DURATION_MS, 1000);
    }
    // 第 threshold 次失败后锁定
    expect(state.failedAttempts).toBe(0); // 锁定后重置
    expect(state.lockedUntil).toBe(1000 + LOCAL_LOCKOUT_DURATION_MS);
    expect(isLocked(state, 1000)).toBe(true);
    expect(remainingLockoutMs(state, 1000)).toBe(LOCAL_LOCKOUT_DURATION_MS);
  });

  it('resets failed count on success', () => {
    let state: LocalLockoutState = { failedAttempts: 3, lockedUntil: 0 };
    state = recordSuccessfulAttempt();
    expect(state.failedAttempts).toBe(0);
    expect(state.lockedUntil).toBe(0);
  });

  it('remainingLockoutMs returns 0 after lockout expires', () => {
    const state: LocalLockoutState = { failedAttempts: 0, lockedUntil: 1000 };
    expect(isLocked(state, 2000)).toBe(false);
    expect(remainingLockoutMs(state, 2000)).toBe(0);
  });
});

describe('local-auth: serialization', () => {
  it('serializes and deserializes a blob', async () => {
    const { blob } = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    const json = serializeLocalAuthBlob(blob);
    expect(typeof json).toBe('string');
    const restored = deserializeLocalAuthBlob(json);
    expect(restored).toEqual(blob);
  });

  it('deserialize rejects malformed JSON', () => {
    expect(() => deserializeLocalAuthBlob('not-json')).toThrow();
  });

  it('deserialize rejects blobs missing required fields', () => {
    const bad: Partial<LocalAuthBlob> = { passwordHash: 'x' };
    expect(() => deserializeLocalAuthBlob(JSON.stringify(bad))).toThrow(/Invalid/);
  });

  it('deserialize rejects blobs missing pwSalt (v2 field)', async () => {
    const { blob } = await setupLocalAuth(GOOD_PASSWORD, FAST_KDF);
    const bad = { ...blob } as Partial<LocalAuthBlob>;
    delete bad.pwSalt;
    expect(() => deserializeLocalAuthBlob(JSON.stringify(bad))).toThrow(/Invalid/);
  });
});
