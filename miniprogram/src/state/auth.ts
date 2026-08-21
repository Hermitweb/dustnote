/**
 * 小程序鉴权 + E2EE 加密流程（v2.0.0 双模式架构）
 *
 * 单机模式（standalone）：
 * - masterKey 随机生成，双重包装（passwordWrappedMasterKey + wrappedMasterKey）
 * - LocalAuthBlob 持久化到 Taro.setStorage（无服务端，无 JWT）
 * - 失败重试由本地 LocalLockoutState 管理（连续 6 次失败锁 15 分钟）
 * - recover 后 masterKey 不变，已有笔记可继续解密 ✅
 * - masterKey 通过 standalone-session 模块缓存（页面间共享）
 *
 * 联机模式（online）：
 * - masterKey 随机生成，用主密码 KEK 包装后存服务端（v2 协议）
 * - access token 持久化到 Taro.setStorage
 * - 失败重试由服务端账号锁定策略管理
 * - serverUrl 从 mode-store 读取（不再硬编码 IP）
 *
 * masterKey 仅存内存，进程退出后清空，需重新解锁。
 */

import { create } from 'zustand';
import React from 'react';
import Taro from '@tarojs/taro';
import {
  ApiClient,
  type Ciphertext,
  deriveSecrets,
  generateMasterKey,
  generateRecoveryCode,
  normalizeRecoveryCode,
  wrapKey,
  unwrapKey,
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
  KDF_PARAMS_MOBILE,
  type LocalAuthBlob,
  type LocalLockoutState,
} from '@dustnote/shared';
import { useModeStore } from '../lib/mode-store';
import { taroFetch } from '../lib/taro-fetch';
import {
  loadLocalAuthBlob,
  loadLocalAuthBlobSync,
  saveLocalAuthBlob,
  saveLocalAuthBlobSync,
  loadLockoutState,
  loadLockoutStateSync,
  saveLockoutState,
  saveLockoutStateSync,
  clearLockoutState,
  hasLocalAuthSync,
} from '../lib/local-auth-storage';
import {
  getStandaloneMasterKey,
  setStandaloneMasterKey,
  clearStandaloneMasterKey,
  initStandaloneSession,
} from '../lib/standalone-session';

// 与 package.json 同步（全端版本统一，见 release 流程）
export const APP_VERSION = '2.5.4';

// 设备 ID：首次生成后持久化到本地存储
let deviceId = '';
try {
  deviceId = Taro.getStorageSync('dustnote_device_id') || '';
  if (!deviceId) {
    deviceId = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    Taro.setStorageSync('dustnote_device_id', deviceId);
  }
} catch {
  deviceId = 'unknown';
}

export type AuthState = 'unknown' | 'uninitialized' | 'needs_unlock' | 'unlocked';

// ========== 加密信封（v2.5.5 迁移到 @dustnote/client-core 单一真相源）==========

export {
  encryptNote,
  decryptNote,
  parseEnvelope,
  type NoteCipherEnvelope,
} from '@dustnote/client-core';
export type { NotePlaintext } from '@dustnote/shared';

interface AuthStoreState {
  authState: AuthState;
  accessToken: string | null;
  userId: string | null;
  /** masterKey 仅存内存，刷新后清空 */
  masterKey: Uint8Array | null;
  /** 服务端下发的 pwSalt（base64），派生 KEK 用（联机模式） */
  pwSalt: string | null;

  // 单机模式相关
  /** 单机模式本地鉴权 blob（仅 standalone 模式有值） */
  localAuthBlob: LocalAuthBlob | null;
  /** 单机模式客户端锁定状态 */
  lockoutState: LocalLockoutState;

  // actions: 通用
  init: () => Promise<void>;
  lock: () => void;
  setAccessToken: (token: string) => void;

  // actions: 联机模式
  setup: (password: string) => Promise<string>; // 返回 recoveryCode
  unlock: (password: string) => Promise<void>;

  // actions: 单机模式
  /** 单机模式：检查本地鉴权状态 */
  checkStatusStandalone: () => Promise<void>;
  /** 单机模式：首次设置主密码；返回恢复码 */
  setupStandalone: (password: string) => Promise<string>;
  /** 单机模式：解锁 */
  unlockStandalone: (password: string) => Promise<void>;
  /** 单机模式：恢复码重置密码；返回新恢复码 */
  recoverStandalone: (recoveryCode: string, newPassword: string) => Promise<string>;
  /** 单机模式：获取剩余锁定时间（ms） */
  getRemainingLockoutMs: () => number;

  /** 修改主密码（standalone 本地重包装 / online rewrap），masterKey 不变，已有笔记可继续解密 */
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
}

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  authState: 'unknown',
  accessToken: null,
  userId: null,
  masterKey: null,
  pwSalt: null,
  localAuthBlob: null,
  lockoutState: { ...INITIAL_LOCKOUT_STATE },

  // ========== 通用 actions ==========

  async init() {
    // 初始化 standalone session（订阅事件）
    initStandaloneSession();

    const { mode, initialized } = useModeStore.getState();
    // 模式未选择时保持 unknown 状态，等待用户选择
    if (!initialized) {
      set({ authState: 'unknown' });
      return;
    }

    if (mode === 'standalone') {
      await get().checkStatusStandalone();
      return;
    }

    // 联机模式：检查服务端状态
    try {
      const r = await getApi().get<{ initialized: boolean; pwSalt: string | null }>(
        '/auth/status'
      );
      set({ pwSalt: r.pwSalt });
      if (!r.initialized) {
        set({ authState: 'uninitialized' });
        return;
      }
      // 已初始化：检查是否有持久化的 access token
      const token = readPersistedToken();
      set({ authState: 'needs_unlock', accessToken: token });
    } catch {
      // 服务端不可达：保持 unknown 让 UI 提示用户
      set({ authState: 'unknown' });
    }
  },

  lock() {
    const k = get().masterKey;
    if (k) k.fill(0);
    clearStandaloneMasterKey();
    clearPersistedToken();
    set({
      authState: 'needs_unlock',
      masterKey: null,
      accessToken: null,
      // 单机模式锁定时也清空内存中的 blob（保留持久化层），下次重新从存储加载
      localAuthBlob: null,
    });
  },

  setAccessToken(token: string) {
    persistToken(token);
    set({ accessToken: token });
  },

  // ========== 联机模式 actions ==========

  async setup(password: string): Promise<string> {
    // v2：masterKey 随机生成，与密码解耦；换密码时只换包装，不动笔记
    const masterKey = generateMasterKey();
    const recoveryCode = generateRecoveryCode();
    const pwSalt = randomBytes(16);
    const rcSalt = randomBytes(16);

    const pw = await deriveSecrets(password, pwSalt);
    const rc = await deriveSecrets(normalizeRecoveryCode(recoveryCode), rcSalt);
    const wrappedPw = await wrapKey(pw.kek, masterKey);
    const wrappedRc = await wrapKey(rc.kek, masterKey);

    const r = await getApi().post<{ accessToken: string; userId: string; deviceId: string }>(
      '/auth/setup',
      {
        // 主密码不出客户端，服务端只拿到 authKey 和密文
        authKey: toBase64(pw.authKey),
        recoveryAuthKey: toBase64(rc.authKey),
        wrappedMasterKeyPw: wrappedPw,
        wrappedMasterKeyRc: wrappedRc,
        pwSalt: toBase64(pwSalt),
        rcSalt: toBase64(rcSalt),
        deviceName: '小程序',
      }
    );

    persistToken(r.accessToken);
    set({
      accessToken: r.accessToken,
      userId: r.userId,
      masterKey,
      pwSalt: toBase64(pwSalt),
      authState: 'unlocked',
    });
    return recoveryCode;
  },

  async unlock(password: string): Promise<void> {
    // v2：pwSalt 在 init 时已拿到；兜底再取一次
    let salt = get().pwSalt;
    if (!salt) {
      const status = await getApi().get<{ pwSalt: string | null }>('/auth/status');
      salt = status.pwSalt;
      if (!salt) throw new Error('系统未初始化');
    }

    const pw = await deriveSecrets(password, fromBase64(salt));
    const r = await getApi().post<{
      accessToken: string;
      userId: string;
      deviceId: string;
      wrappedMasterKey: Ciphertext;
    }>('/auth/unlock', { authKey: toBase64(pw.authKey), deviceName: '小程序' });

    // masterKey 只能在本地解封出来，服务端无从得知
    const masterKey = await unwrapKey(pw.kek, r.wrappedMasterKey);

    persistToken(r.accessToken);
    set({
      accessToken: r.accessToken,
      userId: r.userId,
      masterKey,
      pwSalt: salt,
      authState: 'unlocked',
    });
  },

  // ========== 单机模式 actions ==========

  async checkStatusStandalone(): Promise<void> {
    const blob = loadLocalAuthBlobSync();
    const lockout = loadLockoutStateSync();
    if (!blob) {
      set({ authState: 'uninitialized', lockoutState: lockout });
    } else {
      // 已设置过主密码，需要解锁
      // 检查是否有缓存的 masterKey（同进程内页面跳转后可能仍有）
      const cachedKey = getStandaloneMasterKey();
      set({
        authState: cachedKey ? 'unlocked' : 'needs_unlock',
        localAuthBlob: blob,
        lockoutState: lockout,
        masterKey: cachedKey,
      });
    }
  },

  async setupStandalone(password: string): Promise<string> {
    const result = await setupLocalAuth(password, KDF_PARAMS_MOBILE);
    saveLocalAuthBlobSync(result.blob);
    saveLockoutStateSync({ ...INITIAL_LOCKOUT_STATE });
    setStandaloneMasterKey(result.masterKey);
    set({
      localAuthBlob: result.blob,
      masterKey: result.masterKey,
      lockoutState: { ...INITIAL_LOCKOUT_STATE },
      authState: 'unlocked',
    });
    return result.recoveryCode;
  },

  async unlockStandalone(password: string): Promise<void> {
    const { localAuthBlob, lockoutState } = get();
    const blob = localAuthBlob ?? loadLocalAuthBlobSync();
    if (!blob) throw new Error('未初始化');
    if (isLocked(lockoutState)) {
      const remaining = remainingLockoutMs(lockoutState);
      throw new Error(`账号已锁定，请 ${Math.ceil(remaining / 1000)} 秒后重试`);
    }

    const result = await unlockLocalAuth(password, blob, KDF_PARAMS_MOBILE);
    if (!result.success || !result.masterKey) {
      const newState = recordFailedAttempt(lockoutState);
      saveLockoutStateSync(newState);
      set({ lockoutState: newState });
      if (isLocked(newState)) {
        throw new Error(
          `密码错误次数过多，账号已锁定 ${LOCAL_LOCKOUT_DURATION_MS / 60000} 分钟`
        );
      }
      throw new Error('主密码错误');
    }

    const successState = recordSuccessfulAttempt();
    saveLockoutStateSync(successState);
    setStandaloneMasterKey(result.masterKey);
    set({
      localAuthBlob: blob,
      masterKey: result.masterKey,
      lockoutState: successState,
      authState: 'unlocked',
    });
  },

  async recoverStandalone(recoveryCode: string, newPassword: string): Promise<string> {
    const { localAuthBlob } = get();
    const blob = localAuthBlob ?? loadLocalAuthBlobSync();
    if (!blob) throw new Error('未初始化');
    const result = await recoverLocalAuth(recoveryCode, newPassword, blob, KDF_PARAMS_MOBILE);
    if (!result.success || !result.blob || !result.masterKey || !result.recoveryCode) {
      throw new Error('恢复码错误');
    }
    saveLocalAuthBlobSync(result.blob);
    saveLockoutStateSync({ ...INITIAL_LOCKOUT_STATE });
    setStandaloneMasterKey(result.masterKey);
    set({
      localAuthBlob: result.blob,
      masterKey: result.masterKey,
      lockoutState: { ...INITIAL_LOCKOUT_STATE },
      authState: 'unlocked',
    });
    return result.recoveryCode;
  },

  getRemainingLockoutMs(): number {
    return remainingLockoutMs(get().lockoutState);
  },

  // ========== 修改主密码 ==========

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) throw new Error('新密码至少 8 位');
    const mode = useModeStore.getState().mode;

    // 单机模式：本地校验旧密码后，用新密码 KEK 重新包装同一把 masterKey
    if (mode === 'standalone') {
      const { localAuthBlob } = get();
      const blob = localAuthBlob ?? loadLocalAuthBlobSync();
      if (!blob) throw new Error('未初始化');
      const verify = await unlockLocalAuth(oldPassword, blob, KDF_PARAMS_MOBILE);
      if (!verify.success || !verify.masterKey) throw new Error('当前密码错误');
      // §17.4.1：优先使用 blob 记录的实际 KDF 参数
      const usedParams = blob.kdfParams ?? KDF_PARAMS_MOBILE;
      const newPwSalt = randomBytes(16);
      const { kek, authKey } = await deriveSecrets(newPassword, newPwSalt, usedParams);
      const passwordWrappedMasterKey = await wrapKey(kek, verify.masterKey);
      const newBlob: LocalAuthBlob = {
        ...blob,
        pwSalt: toBase64(newPwSalt),
        passwordHash: toBase64(authKey),
        passwordWrappedMasterKey: JSON.stringify(passwordWrappedMasterKey),
        createdAt: new Date().toISOString(),
      };
      saveLocalAuthBlobSync(newBlob);
      saveLockoutStateSync({ ...INITIAL_LOCKOUT_STATE });
      setStandaloneMasterKey(verify.masterKey);
      set({
        localAuthBlob: newBlob,
        masterKey: verify.masterKey,
        lockoutState: { ...INITIAL_LOCKOUT_STATE },
      });
      return;
    }

    // 联机模式：rewrap（已解锁时 masterKey 在内存中，服务端只收到新包装的密文）
    const masterKey = get().masterKey;
    if (!masterKey) throw new Error('请先解锁');
    const newPwSalt = randomBytes(16);
    const pw = await deriveSecrets(newPassword, newPwSalt);
    const wrappedMasterKey = await wrapKey(pw.kek, masterKey);
    await getApi().post('/auth/rewrap', {
      password: {
        authKey: toBase64(pw.authKey),
        salt: toBase64(newPwSalt),
        wrappedMasterKey,
      },
    });
    set({ pwSalt: toBase64(newPwSalt) });
  },
}));

// ========== API 客户端工厂 ==========

/**
 * 构造 ApiClient（从 mode-store 读取 serverUrl）
 *
 * - H5：serverUrl 为 null 时走相对路径 /api/v1（devServer proxy）
 * - weapp：serverUrl 必须是完整 URL（如 http://192.168.x.x:3210/api/v1）
 * - 联机模式下用户在 mode-select 页输入 serverUrl
 *
 * 注意：weapp 未配置 serverUrl 时不再静默回退到 localhost（真机会因网络不通
 * 导致请求长时间挂起，且错误信息不直观）。改为抛错，由调用方 try/catch
 * 捕获并向用户给出可操作的提示。正常联机模式下此分支不应触发，因为
 * mode-select 页选择联机模式时已强制写入 serverUrl。
 */
export function getApi(): ApiClient {
  const { serverUrl } = useModeStore.getState();
  let baseUrl: string;
  if (serverUrl) {
    baseUrl = `${serverUrl.replace(/\/+$/, '')}/api/v1`;
  } else if (process.env.TARO_ENV === 'h5') {
    baseUrl = '/api/v1';
  } else {
    // weapp 未配置 serverUrl：抛错让上层 UI 友好提示
    throw new Error('未配置服务器地址，请在设置中重新选择联机模式并填写服务器地址');
  }
  return new ApiClient({
    baseUrl,
    clientVersion: APP_VERSION,
    platform: 'miniprogram',
    channel: 'stable',
    deviceId,
    accessToken: useAuthStore.getState().accessToken ?? undefined,
    // weapp 无 fetch，必须走 Taro.request 适配器（tech-architecture.md §6）
    fetch: process.env.TARO_ENV === 'weapp' ? taroFetch : undefined,
  });
}

const TOKEN_KEY = 'dustnote_access_token';

function persistToken(token: string): void {
  try {
    Taro.setStorageSync(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

function readPersistedToken(): string | null {
  try {
    return Taro.getStorageSync(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

function clearPersistedToken(): void {
  try {
    Taro.removeStorageSync(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const init = useAuthStore((s) => s.init);
  React.useEffect(() => {
    void init();
  }, [init]);
  return React.createElement(React.Fragment, null, children);
}

export function useAuthInit(): AuthState {
  return useAuthStore((s) => s.authState);
}
