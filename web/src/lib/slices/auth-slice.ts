/**
 * Auth Slice — 认证、密钥管理、宽限期解锁
 *
 * 包含联机/单机双模式的鉴权流程。
 */

import type { StateCreator } from 'zustand';
import {
  type Ciphertext,
  generateRecoveryCode,
  generateMasterKey,
  deriveSecrets,
  wrapKey,
  unwrapKey,
  normalizeRecoveryCode,
  fromBase64,
  toBase64,
  randomBytes,
  setupLocalAuth,
  unlockLocalAuth,
  recoverLocalAuth,
  recordFailedAttempt,
  recordSuccessfulAttempt,
  isLocked,
  remainingLockoutMs,
  INITIAL_LOCKOUT_STATE,
  LOCAL_LOCKOUT_DURATION_MS,
  type LocalAuthBlob,
  type LocalLockoutState,
} from '@dustnote/shared';
import type { StoreState } from '../store';
import type { AuthState } from '../store-types';
import { api } from '../store-helpers';
import { clearPlainCache } from '../db';
import {
  enableGraceUnlock,
  consumeGraceUnlock,
  peekGraceUnlock,
  isGraceUnlockEnabled,
  getGraceUnlockMin,
} from '../grace-unlock';
import {
  loadLocalAuthBlob,
  saveLocalAuthBlob,
  loadLockoutState,
  saveLockoutState,
  clearLockoutState,
} from '../local-auth-storage';

export interface AuthSlice {
  authState: AuthState;
  serverError: string | null;
  accessToken: string | null;
  userId: string | null;
  serverSalt: string | null;
  masterKey: Uint8Array | null;
  wrappedMasterKey: Ciphertext | null;
  localAuthBlob: LocalAuthBlob | null;
  lockoutState: LocalLockoutState;

  checkStatus: () => Promise<void>;
  setup: (password: string) => Promise<string>;
  unlock: (password: string) => Promise<void>;
  recover: (recoveryCode: string, newPassword: string) => Promise<void>;
  changePassword: (masterPassword: string, newPassword: string) => Promise<void>;
  lock: () => void;
  hasGraceUnlock: () => boolean;
  graceUnlock: () => Promise<boolean>;
  checkStatusStandalone: () => void;
  setupStandalone: (password: string) => Promise<string>;
  unlockStandalone: (password: string) => Promise<void>;
  recoverStandalone: (recoveryCode: string, newPassword: string) => Promise<void>;
  getRemainingLockoutMs: () => number;
}

export const createAuthSlice: StateCreator<StoreState, [], [], AuthSlice> = (set, get) => ({
  authState: 'unknown',
  serverError: null,
  accessToken: null,
  userId: null,
  serverSalt: null,
  masterKey: null,
  wrappedMasterKey: null,
  localAuthBlob: null,
  lockoutState: INITIAL_LOCKOUT_STATE,

  // -------- standalone auth --------

  checkStatusStandalone(): void {
    const blob = loadLocalAuthBlob();
    const lockout = loadLockoutState();
    if (!blob) {
      set({ authState: 'uninitialized', lockoutState: lockout } as Partial<StoreState>);
    } else {
      set({ authState: 'needs_unlock', localAuthBlob: blob, lockoutState: lockout } as Partial<StoreState>);
    }
  },

  async setupStandalone(password: string): Promise<string> {
    const result = await setupLocalAuth(password);
    saveLocalAuthBlob(result.blob);
    clearLockoutState();
    set({
      localAuthBlob: result.blob,
      masterKey: result.masterKey,
      lockoutState: INITIAL_LOCKOUT_STATE,
    } as Partial<StoreState>);
    return result.recoveryCode;
  },

  async unlockStandalone(password: string): Promise<void> {
    const { localAuthBlob, lockoutState } = get();
    if (!localAuthBlob) throw new Error('未初始化');
    if (isLocked(lockoutState)) {
      const remaining = remainingLockoutMs(lockoutState);
      throw new Error(`账号已锁定，请 ${Math.ceil(remaining / 1000)} 秒后重试`);
    }
    const result = await unlockLocalAuth(password, localAuthBlob);
    if (!result.success) {
      const newState = recordFailedAttempt(lockoutState);
      saveLockoutState(newState);
      set({ lockoutState: newState } as Partial<StoreState>);
      if (isLocked(newState)) {
        throw new Error(`密码错误次数过多，账号已锁定 ${LOCAL_LOCKOUT_DURATION_MS / 60000} 分钟`);
      }
      throw new Error('主密码错误');
    }
    const successState = recordSuccessfulAttempt();
    saveLockoutState(successState);
    set({
      masterKey: result.masterKey,
      lockoutState: successState,
      authState: 'unlocked',
    } as Partial<StoreState>);
  },

  async recoverStandalone(recoveryCode: string, newPassword: string): Promise<void> {
    const { localAuthBlob } = get();
    if (!localAuthBlob) throw new Error('未初始化');
    const result = await recoverLocalAuth(recoveryCode, newPassword, localAuthBlob);
    if (!result.success || !result.blob || !result.masterKey || !result.recoveryCode) {
      throw new Error('恢复码错误');
    }
    saveLocalAuthBlob(result.blob);
    clearLockoutState();
    set({
      localAuthBlob: result.blob,
      masterKey: result.masterKey,
      lockoutState: INITIAL_LOCKOUT_STATE,
      authState: 'unlocked',
    } as Partial<StoreState>);
  },

  getRemainingLockoutMs(): number {
    return remainingLockoutMs(get().lockoutState);
  },

  // -------- online auth --------

  async checkStatus(): Promise<void> {
    const { mode } = get();
    if (mode === 'standalone') {
      get().checkStatusStandalone();
      return;
    }
    try {
      const r = await api().get<{
        initialized: boolean;
        deviceKnown: boolean;
        pwSalt: string | null;
      }>('/auth/status');
      if (!r.initialized) {
        set({ authState: 'uninitialized', serverError: null, serverSalt: null } as Partial<StoreState>);
      } else {
        set({ authState: 'needs_unlock', serverError: null, serverSalt: r.pwSalt } as Partial<StoreState>);
      }
    } catch (err) {
      set({
        authState: 'error',
        serverError: err instanceof Error ? err.message : String(err),
      } as Partial<StoreState>);
    }
  },

  async setup(password: string): Promise<string> {
    const masterKey = generateMasterKey();
    const recoveryCode = generateRecoveryCode();
    const pwSalt = randomBytes(16);
    const rcSalt = randomBytes(16);

    const [pw, rc] = await Promise.all([
      deriveSecrets(password, pwSalt),
      deriveSecrets(normalizeRecoveryCode(recoveryCode), rcSalt),
    ]);
    const [wrappedPw, wrappedRc] = await Promise.all([
      wrapKey(pw.kek, masterKey),
      wrapKey(rc.kek, masterKey),
    ]);

    const r = await api().post<{
      accessToken: string;
      userId: string;
      deviceId: string;
    }>('/auth/setup', {
      authKey: toBase64(pw.authKey),
      recoveryAuthKey: toBase64(rc.authKey),
      wrappedMasterKeyPw: wrappedPw,
      wrappedMasterKeyRc: wrappedRc,
      pwSalt: toBase64(pwSalt),
      rcSalt: toBase64(rcSalt),
      deviceName: 'Web 浏览器',
    });

    set({
      accessToken: r.accessToken,
      userId: r.userId,
      serverSalt: toBase64(pwSalt),
      masterKey,
      wrappedMasterKey: wrappedPw,
    } as Partial<StoreState>);
    return recoveryCode;
  },

  async unlock(password: string): Promise<void> {
    let salt = get().serverSalt;
    if (!salt) {
      const status = await api().get<{
        initialized: boolean;
        pwSalt: string | null;
      }>('/auth/status');
      salt = status.pwSalt;
      if (!salt) throw new Error('系统未初始化');
    }

    const pw = await deriveSecrets(password, fromBase64(salt));
    const r = await api().post<{
      accessToken: string;
      userId: string;
      deviceId: string;
      wrappedMasterKey: Ciphertext;
    }>('/auth/unlock', {
      authKey: toBase64(pw.authKey),
      deviceName: 'Web 浏览器',
    });

    const masterKey = await unwrapKey(pw.kek, r.wrappedMasterKey);

    set({
      accessToken: r.accessToken,
      userId: r.userId,
      serverSalt: salt,
      masterKey,
      wrappedMasterKey: r.wrappedMasterKey,
      authState: 'unlocked',
    } as Partial<StoreState>);
  },

  async recover(recoveryCode: string, newPassword: string): Promise<void> {
    const a = api();
    const { rcSalt } = await a.get<{ rcSalt: string }>('/auth/recovery-params');
    const rc = await deriveSecrets(normalizeRecoveryCode(recoveryCode), fromBase64(rcSalt));

    const r = await a.post<{
      accessToken: string;
      userId: string;
      deviceId: string;
      wrappedMasterKey: Ciphertext;
    }>('/auth/recover', {
      recoveryAuthKey: toBase64(rc.authKey),
      deviceName: 'Web 浏览器（恢复）',
    });

    const masterKey = await unwrapKey(rc.kek, r.wrappedMasterKey);

    const newPwSalt = randomBytes(16);
    const pw = await deriveSecrets(newPassword, newPwSalt);
    const wrappedPw = await wrapKey(pw.kek, masterKey);

    set({ accessToken: r.accessToken } as Partial<StoreState>);
    await api().post('/auth/rewrap', {
      password: {
        authKey: toBase64(pw.authKey),
        salt: toBase64(newPwSalt),
        wrappedMasterKey: wrappedPw,
      },
    });

    set({
      accessToken: r.accessToken,
      userId: r.userId,
      serverSalt: toBase64(newPwSalt),
      masterKey,
      wrappedMasterKey: wrappedPw,
      authState: 'unlocked',
    } as Partial<StoreState>);
  },

  async changePassword(masterPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) throw new Error('新主密码至少 8 个字符');
    const { mode } = get();

    if (mode === 'standalone') {
      const { localAuthBlob, lockoutState } = get();
      if (!localAuthBlob) throw new Error('未初始化');
      if (isLocked(lockoutState)) {
        const rem = remainingLockoutMs(lockoutState);
        throw new Error(`账号已锁定，请 ${Math.ceil(rem / 1000)} 秒后重试`);
      }
      const result = await unlockLocalAuth(masterPassword, localAuthBlob);
      if (!result.success || !result.masterKey) {
        const newState = recordFailedAttempt(lockoutState);
        saveLockoutState(newState);
        set({ lockoutState: newState } as Partial<StoreState>);
        if (isLocked(newState)) {
          throw new Error(`密码错误次数过多，账号已锁定 ${LOCAL_LOCKOUT_DURATION_MS / 60000} 分钟`);
        }
        throw new Error('当前密码错误');
      }
      const newPwSalt = randomBytes(16);
      const { kek: newKek, authKey: newAuthKey } = await deriveSecrets(newPassword, newPwSalt);
      const newWrapped = await wrapKey(newKek, result.masterKey);
      const newBlob: LocalAuthBlob = {
        ...localAuthBlob,
        pwSalt: toBase64(newPwSalt),
        passwordHash: toBase64(newAuthKey),
        passwordWrappedMasterKey: JSON.stringify(newWrapped),
      };
      saveLocalAuthBlob(newBlob);
      clearLockoutState();
      set({ localAuthBlob: newBlob, lockoutState: INITIAL_LOCKOUT_STATE } as Partial<StoreState>);
      return;
    }

    let salt = get().serverSalt;
    if (!salt) {
      const status = await api().get<{ initialized: boolean; pwSalt: string | null }>('/auth/status');
      salt = status.pwSalt;
      if (!salt) throw new Error('系统未初始化');
    }
    const pw = await deriveSecrets(masterPassword, fromBase64(salt));
    const r = await api().post<{
      accessToken: string;
      userId: string;
      wrappedMasterKey: Ciphertext;
    }>('/auth/unlock', {
      authKey: toBase64(pw.authKey),
      deviceName: 'Web 浏览器',
    });
    const masterKey = await unwrapKey(pw.kek, r.wrappedMasterKey);
    const newPwSalt = randomBytes(16);
    const npw = await deriveSecrets(newPassword, newPwSalt);
    const wrappedPw = await wrapKey(npw.kek, masterKey);
    set({ accessToken: r.accessToken } as Partial<StoreState>);
    await api().post('/auth/rewrap', {
      password: {
        authKey: toBase64(npw.authKey),
        salt: toBase64(newPwSalt),
        wrappedMasterKey: wrappedPw,
      },
    });
    set({ serverSalt: toBase64(newPwSalt), wrappedMasterKey: wrappedPw } as Partial<StoreState>);
  },

  lock(): void {
    const k = get().masterKey;
    if (k && isGraceUnlockEnabled()) {
      enableGraceUnlock(k, get().wrappedMasterKey, getGraceUnlockMin());
    }
    if (k) k.fill(0);
    set({
      masterKey: null,
      accessToken: null,
      selectedNoteId: null,
      notesPlain: new Map(),
      authState: 'needs_unlock',
    } as Partial<StoreState>);
    void clearPlainCache().catch(() => undefined);
  },

  hasGraceUnlock(): boolean {
    return peekGraceUnlock();
  },

  async graceUnlock(): Promise<boolean> {
    const cached = consumeGraceUnlock();
    if (!cached) return false;
    if (get().mode === 'online') {
      try {
        const r = await api().post<{ accessToken: string }>('/auth/refresh');
        set({
          masterKey: cached.masterKey,
          wrappedMasterKey: cached.wrappedMasterKey,
          accessToken: r.accessToken,
          authState: 'unlocked',
        } as Partial<StoreState>);
        return true;
      } catch {
        set({ authState: 'needs_unlock' } as Partial<StoreState>);
        return false;
      }
    }
    set({
      masterKey: cached.masterKey,
      wrappedMasterKey: cached.wrappedMasterKey,
      authState: 'unlocked',
    } as Partial<StoreState>);
    return true;
  },
});
