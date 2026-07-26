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
  INITIAL_LOCKOUT_STATE,
  LOCAL_LOCKOUT_THRESHOLD,
  LOCAL_LOCKOUT_DURATION_MS,
} from '../src/local-auth';
import type { LocalAuthBlob, LocalLockoutState } from '../src/types';

const GOOD_PASSWORD = 'correct-horse-battery-staple';

describe('local-auth: setupLocalAuth', () => {
  it('produces a blob, masterKey, and 6-digit recovery code', async () => {
    const result = await setupLocalAuth(GOOD_PASSWORD);
    expect(result.blob).toBeDefined();
    expect(result.masterKey).toBeInstanceOf(Uint8Array);
    expect(result.masterKey.length).toBe(32);
    expect(result.recoveryCode).toMatch(/^\d{6}$/);
  });

  it('rejects passwords shorter than 8 chars', async () => {
    await expect(setupLocalAuth('short')).rejects.toThrow(/至少 8 字符/);
  });

  it('generates unique salts per setup', async () => {
    const a = await setupLocalAuth(GOOD_PASSWORD);
    const b = await setupLocalAuth(GOOD_PASSWORD);
    expect(a.blob.masterSalt).not.toBe(b.blob.masterSalt);
    expect(a.blob.clientMasterSalt).not.toBe(b.blob.clientMasterSalt);
    expect(a.blob.recoverySalt).not.toBe(b.blob.recoverySalt);
    expect(a.recoveryCode).not.toBe(b.recoveryCode);
  });

  it('blob contains all required fields', async () => {
    const { blob } = await setupLocalAuth(GOOD_PASSWORD);
    expect(typeof blob.passwordHash).toBe('string');
    expect(typeof blob.masterSalt).toBe('string');
    expect(typeof blob.clientMasterSalt).toBe('string');
    expect(typeof blob.wrappedMasterKey).toBe('string');
    expect(typeof blob.passwordWrappedMasterKey).toBe('string');
    expect(typeof blob.recoveryHash).toBe('string');
    expect(typeof blob.recoverySalt).toBe('string');
    expect(typeof blob.kdfVersion).toBe('number');
    expect(typeof blob.createdAt).toBe('string');
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
    const setup = await setupLocalAuth(GOOD_PASSWORD);
    const result = await unlockLocalAuth(GOOD_PASSWORD, setup.blob);
    expect(result.success).toBe(true);
    expect(result.masterKey).toBeInstanceOf(Uint8Array);
    expect(result.masterKey!.length).toBe(32);
    // masterKey 必须与 setup 时返回的一致
    expect(Array.from(result.masterKey!)).toEqual(Array.from(setup.masterKey));
  });

  it('fails with wrong password', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD);
    const result = await unlockLocalAuth('wrong-password-12345', setup.blob);
    expect(result.success).toBe(false);
    expect(result.masterKey).toBeNull();
  });

  it('produces same masterKey across multiple unlocks', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD);
    const r1 = await unlockLocalAuth(GOOD_PASSWORD, setup.blob);
    const r2 = await unlockLocalAuth(GOOD_PASSWORD, setup.blob);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(Array.from(r1.masterKey!)).toEqual(Array.from(r2.masterKey!));
  });
});

describe('local-auth: recoverLocalAuth', () => {
  it('succeeds with correct recovery code and produces new blob/masterKey/recoveryCode', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD);
    const result = await recoverLocalAuth(setup.recoveryCode, 'new-password-12345', setup.blob);
    expect(result.success).toBe(true);
    expect(result.blob).not.toBeNull();
    expect(result.masterKey).toBeInstanceOf(Uint8Array);
    expect(result.recoveryCode).toMatch(/^\d{6}$/);
    // 新恢复码必须与旧的不同
    expect(result.recoveryCode).not.toBe(setup.recoveryCode);
    // 新 salts 必须与旧的不同
    expect(result.blob!.masterSalt).not.toBe(setup.blob.masterSalt);
  });

  it('fails with wrong recovery code', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD);
    const result = await recoverLocalAuth('000000', 'new-password-12345', setup.blob);
    expect(result.success).toBe(false);
    expect(result.blob).toBeNull();
    expect(result.masterKey).toBeNull();
    expect(result.recoveryCode).toBeNull();
  });

  it('new password can unlock the new blob', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD);
    const recovered = await recoverLocalAuth(setup.recoveryCode, 'new-password-12345', setup.blob);
    expect(recovered.success).toBe(true);
    const unlockResult = await unlockLocalAuth('new-password-12345', recovered.blob!);
    expect(unlockResult.success).toBe(true);
    // 新 masterKey 必须与 recover 返回的一致
    expect(Array.from(unlockResult.masterKey!)).toEqual(Array.from(recovered.masterKey!));
  });

  it('preserves the original masterKey after recovery (existing notes remain decryptable)', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD);
    const recovered = await recoverLocalAuth(setup.recoveryCode, 'new-password-12345', setup.blob);
    expect(recovered.success).toBe(true);
    // 关键：recover 后 masterKey 必须与 setup 时一致（已有笔记可继续解密）
    expect(Array.from(recovered.masterKey!)).toEqual(Array.from(setup.masterKey));
  });

  it('old password cannot unlock the new blob', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD);
    const recovered = await recoverLocalAuth(setup.recoveryCode, 'new-password-12345', setup.blob);
    expect(recovered.success).toBe(true);
    const unlockResult = await unlockLocalAuth(GOOD_PASSWORD, recovered.blob!);
    expect(unlockResult.success).toBe(false);
  });

  it('rejects new passwords shorter than 8 chars', async () => {
    const setup = await setupLocalAuth(GOOD_PASSWORD);
    await expect(
      recoverLocalAuth(setup.recoveryCode, 'short', setup.blob)
    ).rejects.toThrow(/至少 8 字符/);
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
    const { blob } = await setupLocalAuth(GOOD_PASSWORD);
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

  it('deserialize rejects blobs missing passwordWrappedMasterKey (v2 field)', async () => {
    const { blob } = await setupLocalAuth(GOOD_PASSWORD);
    const v1Blob = { ...blob } as Partial<LocalAuthBlob>;
    delete v1Blob.passwordWrappedMasterKey;
    expect(() => deserializeLocalAuthBlob(JSON.stringify(v1Blob))).toThrow(/Invalid/);
  });
});
