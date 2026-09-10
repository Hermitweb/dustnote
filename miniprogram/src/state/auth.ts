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
import { t } from '../lib/i18n';
import { ensureRandomReady } from '../lib/crypto-polyfill';
import { clearPlainCache } from '../lib/plain-cache';
import { startSyncWs, stopSyncWs } from '../lib/sync-ws';
import {
  cacheMasterKeyForBiometric,
  isBiometricEnabled,
  readCachedMasterKey,
} from '../lib/biometric';
import { useConflictStore } from './conflict-store';
import {
  type FetchFn,
  ApiClient,
  type Ciphertext,
  type KdfParams,
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
  KDF_VERSION,
  type LocalAuthBlob,
  type LocalLockoutState,
} from '@dustnote/shared';
import { useModeStore } from '../lib/mode-store';
import { getRepo } from '../lib/get-repo';
import {
  consumePendingMigration,
  clearPendingMigration,
  loadPendingMigration,
  persistWrappedOldMasterKey,
} from '../lib/migration';
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
export const APP_VERSION = '2.5.38';

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
  /** 模式切换迁移：暂存的旧 masterKey（lock() 不清除，新模式鉴权成功后消费） */
  pendingMasterKey: Uint8Array | null;

  // actions: 通用
  init: () => Promise<void>;
  lock: () => void;
  setAccessToken: (token: string) => void;

  // actions: 联机模式
  setup: (password: string) => Promise<string>; // 返回 recoveryCode
  unlock: (password: string, totpCode?: string) => Promise<void>;

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

  /** 修改主密码（standalone 本地重包装 / online rewrap），masterKey 不变，已有笔记可继续解密。
   *  standalone 返回新恢复码（旧恢复码随之失效，调用方须展示）；online 返回 null */
  changePassword: (oldPassword: string, newPassword: string) => Promise<string | null>;
  /** 联机模式：恢复码找回密码（忘密码唯一自救通道，对齐安卓端 recoverOnline） */
  recoverOnline: (recoveryCode: string, newPassword: string) => Promise<void>;
  /** 模式切换迁移：暂存旧 masterKey（lock() 不清除，新模式鉴权成功后消费） */
  setPendingMasterKey: (key: Uint8Array | null) => void;
  /** 指纹解锁：SOTER 验证由 UI 发起，这里恢复缓存的 masterKey 并进入解锁态 */
  unlockWithBiometric: () => Promise<boolean>;
}

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  authState: 'unknown',
  accessToken: null,
  userId: null,
  masterKey: null,
  pwSalt: null,
    localAuthBlob: null,
    lockoutState: { ...INITIAL_LOCKOUT_STATE },
    pendingMasterKey: null,

    setPendingMasterKey: (key) => set({ pendingMasterKey: key }),

    unlockWithBiometric: async () => {
      const cached = readCachedMasterKey();
      if (!cached) return false;
      const mode = useModeStore.getState().mode;
      if (mode === 'standalone') {
        const blob = loadLocalAuthBlobSync();
        if (!blob) return false;
        set({ authState: 'unlocked', masterKey: cached, localAuthBlob: blob });
        return true;
      }
      // 联机：恢复持久化 token（已过期由 401 静默刷新兜底）。
      // startSyncWs 延后一拍执行：连接初始化不阻塞指纹解锁的跳转
      const token = readPersistedToken();
      if (!token) return false;
      set({ authState: 'unlocked', masterKey: cached, accessToken: token });
      setTimeout(() => {
        try {
          startSyncWs();
        } catch {
          /* ignore */
        }
      }, 0);
      return true;
    },

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
      const r = await getApi().get<{ initialized: boolean; pwSalt: string | null }>('/auth/status');
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
    clearPersistedRefreshToken();
    stopSyncWs();
    // 锁屏清掉内存中的明文残留(解密缓存/未裁决冲突),明文不跨锁屏存活
    try {
      clearPlainCache();
      useConflictStore.setState({ pendingConflicts: [] });
    } catch {
      /* 循环依赖保护:缺失时跳过 */
    }
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
    // 联机模式 token 就绪:启动实时同步(单机模式内部无 serverUrl 会直接返回)
    try {
      startSyncWs();
    } catch {
      /* ignore */
    }
  },

  // ========== 联机模式 actions ==========

  async setup(password: string): Promise<string> {
    await ensureRandomReady();
    // v2：masterKey 随机生成，与密码解耦；换密码时只换包装，不动笔记
    const masterKey = generateMasterKey();
    const recoveryCode = generateRecoveryCode();
    const pwSalt = randomBytes(16);
    const rcSalt = randomBytes(16);

    const pw = await deriveSecrets(password, pwSalt);
    const rc = await deriveSecrets(normalizeRecoveryCode(recoveryCode), rcSalt);
    const wrappedPw = await wrapKey(pw.kek, masterKey);
    const wrappedRc = await wrapKey(rc.kek, masterKey);

    const r = await getApi().post<{
      accessToken: string;
      userId: string;
      deviceId: string;
      refreshToken: string;
    }>(
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
    if (r.refreshToken) persistRefreshToken(r.refreshToken);
    try {
      startSyncWs();
    } catch {
      /* ignore */
    }
    set({
      accessToken: r.accessToken,
      userId: r.userId,
      masterKey,
      pwSalt: toBase64(pwSalt),
      authState: 'unlocked',
    });
    // 指纹解锁已启用：续写缓存（保证缓存与账号当前 masterKey 一致）
    if (isBiometricEnabled()) cacheMasterKeyForBiometric(masterKey);
    void runPendingMigration();
    return recoveryCode;
  },

  async unlock(password: string, totpCode?: string): Promise<void> {
    // v2：pwSalt 在 init 时已拿到；兜底再取一次（同时读取账号 KDF 参数——
    // Argon2id 老账号必须按服务端记录的参数派生，新默认 PBKDF2 会得到
    // 不匹配的 authKey 而恒 401）
    let salt = get().pwSalt;
    let kdfParams: KdfParams | undefined;
    if (!salt) {
      const status = await getApi().get<{ pwSalt: string | null; kdfParams?: KdfParams }>('/auth/status');
      salt = status.pwSalt;
      kdfParams = status.kdfParams;
      if (!salt) throw new Error('系统未初始化');
    } else {
      try {
        const status = await getApi().get<{ kdfParams?: KdfParams }>('/auth/status');
        kdfParams = status.kdfParams;
      } catch {
        /* 用默认参数 */
      }
    }

    const pw = await deriveSecrets(password, fromBase64(salt), kdfParams);
    const body: { authKey: string; deviceName: string; totpCode?: string } = {
      authKey: toBase64(pw.authKey),
      deviceName: '小程序',
    };
    if (totpCode) body.totpCode = totpCode;
    const r = await getApi().post<{
      accessToken: string;
      userId: string;
      deviceId: string;
      refreshToken: string;
      wrappedMasterKey: Ciphertext;
    }>('/auth/unlock', body);

    // masterKey 只能在本地解封出来，服务端无从得知
    const masterKey = await unwrapKey(pw.kek, r.wrappedMasterKey);

    persistToken(r.accessToken);
    if (r.refreshToken) persistRefreshToken(r.refreshToken);
    try {
      startSyncWs();
    } catch {
      /* ignore */
    }
    set({
      accessToken: r.accessToken,
      userId: r.userId,
      masterKey,
      pwSalt: salt,
      authState: 'unlocked',
    });
    if (isBiometricEnabled()) cacheMasterKeyForBiometric(masterKey);
    void runPendingMigration();
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
    await ensureRandomReady();
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
    if (isBiometricEnabled()) cacheMasterKeyForBiometric(result.masterKey);
    void runPendingMigration();
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
        throw new Error(`密码错误次数过多，账号已锁定 ${LOCAL_LOCKOUT_DURATION_MS / 60000} 分钟`);
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
    if (isBiometricEnabled()) cacheMasterKeyForBiometric(result.masterKey);
    void runPendingMigration();
  },

  async recoverStandalone(recoveryCode: string, newPassword: string): Promise<string> {
    await ensureRandomReady();
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
    void runPendingMigration();
    return result.recoveryCode;
  },

  getRemainingLockoutMs(): number {
    return remainingLockoutMs(get().lockoutState);
  },

  // ========== 修改主密码 ==========

  async changePassword(oldPassword: string, newPassword: string): Promise<string | null> {
    await ensureRandomReady();
    if (newPassword.length < 6) throw new Error('新密码至少 6 位');
    const mode = useModeStore.getState().mode;

    // 单机模式：本地校验旧密码后，用同一把 masterKey + 新密码重建完整 blob
    // （新恢复码随之生成，旧恢复码失效——对齐安卓端 changePasswordStandalone）
    if (mode === 'standalone') {
      const { localAuthBlob, lockoutState } = get();
      const blob = localAuthBlob ?? loadLocalAuthBlobSync();
      if (!blob) throw new Error('未初始化');
      if (isLocked(lockoutState)) {
        throw new Error(`账号已锁定，请 ${Math.ceil(remainingLockoutMs(lockoutState) / 1000)} 秒后重试`);
      }
      const verify = await unlockLocalAuth(oldPassword, blob, KDF_PARAMS_MOBILE);
      if (!verify.success || !verify.masterKey) throw new Error('当前密码错误');
      const newAuth = await buildLocalAuthBlobForMasterKey(verify.masterKey, newPassword);
      saveLocalAuthBlobSync(newAuth.blob);
      saveLockoutStateSync({ ...INITIAL_LOCKOUT_STATE });
      setStandaloneMasterKey(verify.masterKey);
      set({
        localAuthBlob: newAuth.blob,
        masterKey: verify.masterKey,
        lockoutState: { ...INITIAL_LOCKOUT_STATE },
      });
      return newAuth.recoveryCode;
    }

    // 联机模式：rewrap（已解锁时 masterKey 在内存中，服务端只收到新包装的密文）
    // 新密码派生沿用账号当前 KDF 参数（/auth/status），服务端记录不变，
    // 避免 rewrap 后按记录参数派生不一致导致跨端解锁失败
    const masterKey = get().masterKey;
    if (!masterKey) throw new Error(t('common.need_unlock'));
    let kdfParams: KdfParams | undefined;
    try {
      const status = await getApi().get<{ kdfParams?: KdfParams }>('/auth/status');
      kdfParams = status.kdfParams;
    } catch {
      /* 用默认参数 */
    }
    const newPwSalt = randomBytes(16);
    const pw = await deriveSecrets(newPassword, newPwSalt, kdfParams);
    const wrappedMasterKey = await wrapKey(pw.kek, masterKey);
    await getApi().post('/auth/rewrap', {
      password: {
        authKey: toBase64(pw.authKey),
        salt: toBase64(newPwSalt),
        wrappedMasterKey,
      },
    });
    set({ pwSalt: toBase64(newPwSalt) });
    // 联机模式无新恢复码概念（恢复包装未变）
    return null;
  },

  async recoverOnline(recoveryCode: string, newPassword: string): Promise<void> {
    await ensureRandomReady();
    if (newPassword.length < 6) throw new Error('新密码至少 6 位');
    // v2：先取恢复码派生所需的 rc_salt + 账号 KDF 参数（直接用服务端记录的参数）
    const recoveryParams = await getApi().get<{
      rcSalt: string;
      kdfParams?: KdfParams;
    }>('/auth/recovery-params');
    const kdfParams = recoveryParams.kdfParams ?? KDF_PARAMS_MOBILE;
    const rc = await deriveSecrets(
      normalizeRecoveryCode(recoveryCode),
      fromBase64(recoveryParams.rcSalt),
      kdfParams
    );

    const r = await getApi().post<{
      accessToken: string;
      userId: string;
      deviceId: string;
      refreshToken?: string;
      wrappedMasterKey: Ciphertext;
    }>('/auth/recover', {
      recoveryAuthKey: toBase64(rc.authKey),
      deviceName: '小程序',
    });

    // 解封出来的是原来那把 masterKey：历史笔记照常能解开
    const masterKey = await unwrapKey(rc.kek, r.wrappedMasterKey);

    // 拿回 masterKey 后立刻用新密码重新包装（masterKey 不变；
    // 派生沿用账号 KDF 参数，避免 rewrap 后跨端锁死）
    const newPwSalt = randomBytes(16);
    const pw = await deriveSecrets(newPassword, newPwSalt, kdfParams);
    const wrappedPw = await wrapKey(pw.kek, masterKey);

    // 先落 token（rewrap 是鉴权接口），再重包装
    persistToken(r.accessToken);
    if (r.refreshToken) persistRefreshToken(r.refreshToken);
    set({ accessToken: r.accessToken });
    await getApi().post('/auth/rewrap', {
      password: {
        authKey: toBase64(pw.authKey),
        salt: toBase64(newPwSalt),
        wrappedMasterKey: wrappedPw,
      },
    });

    set({
      authState: 'unlocked',
      accessToken: r.accessToken,
      masterKey,
      pwSalt: toBase64(newPwSalt),
      userId: r.userId,
    });
    if (isBiometricEnabled()) cacheMasterKeyForBiometric(masterKey);
    try {
      startSyncWs();
    } catch {
      /* ignore */
    }
    void runPendingMigration();
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
  // 401 恢复路径：先用 refresh token 静默续签（单飞），成功则换新 token 重放
  // 原请求；刷新失败（宽限期已过/设备被吊销/无 refresh token）才锁定回解锁页。
  // 排除 /auth/ 自身(解锁密码错误本来就返回 401,属正常业务语义)。
  const authExpiredFetch: FetchFn = async (url, init) => {
    let res = await (process.env.TARO_ENV === 'weapp'
      ? taroFetch(url, init)
      : fetch(url, init));
    if (res.status === 401 && !String(url).includes('/auth/')) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        const replayInit = {
          ...init,
          headers: { ...init.headers, Authorization: 'Bearer ' + newToken },
        };
        res = await (process.env.TARO_ENV === 'weapp'
          ? taroFetch(url, replayInit)
          : fetch(url, replayInit));
      } else {
        try {
          useAuthStore.getState().lock();
          Taro.showToast({ title: t('common.login_expired'), icon: 'none' });
        } catch {
          /* ignore */
        }
      }
    }
    return res;
  };
  return new ApiClient({
    baseUrl,
    clientVersion: APP_VERSION,
    platform: 'miniprogram',
    channel: 'stable',
    deviceId,
    accessToken: useAuthStore.getState().accessToken ?? undefined,
    // weapp 无 fetch，必须走 Taro.request 适配器（tech-architecture.md §6）
    fetch: authExpiredFetch,
  });
}

const TOKEN_KEY = 'dustnote_access_token';

/** 消费待迁移数据（对齐安卓端 runPendingMigration）：新模式 setup/unlock/recover
 *  成功后调用。导入失败把旧 masterKey 用当前 key 包装写回槽，下次解锁自动重试。 */
async function runPendingMigration(): Promise<void> {
  const { masterKey, pendingMasterKey } = useAuthStore.getState();
  if (!masterKey) return;
  const slot = loadPendingMigration();
  if (!slot) return;
  let oldKey = pendingMasterKey;
  if (!oldKey && slot.wrappedOldMasterKey) {
    try {
      oldKey = await unwrapKey(masterKey, slot.wrappedOldMasterKey);
    } catch {
      oldKey = null;
    }
  }
  if (!oldKey) {
    // M9 困死提示：切换模式后进程被杀,pendingMasterKey(仅内存)丢失且槽内
    // 尚无可解封的包装 key——迁移静默不发生,必须让用户知道恢复路径
    Taro.showToast({
      title: t('settings.migration_pending'),
      icon: 'none',
      duration: 4000,
    });
    return;
  }
  const mode = useModeStore.getState().mode;
  try {
    const result = await consumePendingMigration(getRepo(), masterKey, oldKey);
    if (!result) return;
    if (result.failed > 0) {
      // C1b：部分失败必须披露并保留槽——笔记逐条上传可能撞限流/网络抖动,
      // 此前失败条数被静默丢弃、槽被无条件清除,失败的笔记无声丢失
      try {
        await persistWrappedOldMasterKey(slot, masterKey, oldKey);
      } catch {
        /* ignore */
      }
      Taro.showToast({
        title: t('settings.migrated_failed', { count: result.imported, failed: result.failed }),
        icon: 'none',
        duration: 4000,
      });
      return;
    }
    clearPendingMigration();
    useAuthStore.setState({ pendingMasterKey: null });
    Taro.showToast({
      title: t('settings.migrated_count', { count: result.imported }),
      icon: 'none',
      duration: 3000,
    });
  } catch {
    try {
      await persistWrappedOldMasterKey(slot, masterKey, oldKey);
    } catch {
      /* ignore */
    }
  }
}

/** 用既有 masterKey + 新密码重建本地鉴权 blob（对齐安卓端同名助手）：
 * 新恢复码随之生成、旧恢复码失效；kdfParams 沿用单机端当前默认 */
async function buildLocalAuthBlobForMasterKey(
  masterKey: Uint8Array,
  password: string
): Promise<{ blob: LocalAuthBlob; recoveryCode: string }> {
  const pwSalt = randomBytes(16);
  const rcSalt = randomBytes(16);

  const pw = await deriveSecrets(password, pwSalt, KDF_PARAMS_MOBILE);
  const passwordWrappedMasterKey = await wrapKey(pw.kek, masterKey);

  const recoveryCode = generateRecoveryCode();
  const rc = await deriveSecrets(normalizeRecoveryCode(recoveryCode), rcSalt, KDF_PARAMS_MOBILE);
  const wrappedMasterKey = await wrapKey(rc.kek, masterKey);

  const blob: LocalAuthBlob = {
    pwSalt: toBase64(pwSalt),
    rcSalt: toBase64(rcSalt),
    passwordHash: toBase64(pw.authKey),
    passwordWrappedMasterKey: JSON.stringify(passwordWrappedMasterKey),
    wrappedMasterKey: JSON.stringify(wrappedMasterKey),
    recoveryHash: toBase64(rc.authKey),
    kdfVersion: KDF_VERSION,
    kdfParams: { ...KDF_PARAMS_MOBILE },
    createdAt: new Date().toISOString(),
  };
  return { blob, recoveryCode };
}

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

const REFRESH_KEY = 'dustnote_refresh';

function persistRefreshToken(token: string): void {
  try {
    Taro.setStorageSync(REFRESH_KEY, token);
  } catch {
    /* ignore */
  }
}

function readPersistedRefreshToken(): string | null {
  try {
    return Taro.getStorageSync(REFRESH_KEY) || null;
  } catch {
    return null;
  }
}

function clearPersistedRefreshToken(): void {
  try {
    Taro.removeStorageSync(REFRESH_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 静默续签 access token（单飞，防并发 401 风暴重复刷新）
 *
 * 服务端 /auth/refresh 走 X-Refresh-Token header 通道（同 mobile/desktop），
 * 响应体自管轮换 refresh token。成功后更新 store 并重启同步 WS；
 * 失败返回 null，由调用方走锁定回解锁页的兜底路径。
 */
let refreshInFlight: Promise<string | null> | null = null;

function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const stored = readPersistedRefreshToken();
      if (!stored) return null;
      const { serverUrl } = useModeStore.getState();
      if (!serverUrl) return null;
      const base = serverUrl.replace(/\/+$/, '') + '/api/v1';
      const res = await (process.env.TARO_ENV === 'weapp'
        ? taroFetch(base + '/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Refresh-Token': stored },
            body: '{}',
          })
        : fetch(base + '/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Refresh-Token': stored },
            body: '{}',
          }));
      if (!res.ok) return null;
      const text = await res.text();
      const data = JSON.parse(text) as { accessToken?: string; refreshToken?: string };
      if (!data.accessToken) return null;
      persistToken(data.accessToken);
      if (data.refreshToken) persistRefreshToken(data.refreshToken);
      useAuthStore.setState({ accessToken: data.accessToken });
      try {
        startSyncWs();
      } catch {
        /* ignore */
      }
      return data.accessToken;
    } catch {
      return null;
    } finally {
      // 单飞窗口结束后允许下一次刷新
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();
  return refreshInFlight;
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
