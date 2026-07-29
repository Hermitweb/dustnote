/**
 * 鉴权状态（v2.0.0 双模式架构）
 *
 * 联机模式（online）：
 * - uninitialized / needs_unlock / unlocked
 * - masterKey 随机生成，用主密码 KEK 包装后存服务端（v2 协议）
 * - access token 持久化到 AsyncStorage，masterKey 可缓存到 keychain（生物识别）
 * - 失败重试由服务端账号锁定策略管理（连续 6 次失败锁 15 分钟）
 *
 * 单机模式（standalone）：
 * - uninitialized / needs_unlock / unlocked
 * - masterKey 随机生成，双重包装（passwordWrappedMasterKey + wrappedMasterKey）
 * - LocalAuthBlob 持久化到 AsyncStorage（无服务端，无 JWT）
 * - 失败重试由本地 LocalLockoutState 管理（连续 6 次失败锁 15 分钟）
 * - recover 后 masterKey 不变，已有笔记可继续解密 ✅
 *
 * masterKey 仅存内存，App 后台时自动清空（lock()）
 *
 * 生物识别解锁流程（联机 + 单机模式）：
 * 1. 首次 setup / 密码解锁成功后，将 masterKey（base64）以 BIOMETRY 访问控制
 *    写入 react-native-keychain；联机模式同时将 access token 持久化到 AsyncStorage。
 * 2. 下次启动时若 keychain 有缓存，则可走生物识别：通过指纹 / 面容后，
 *    keychain 返回缓存的 masterKey，直接进入已解锁状态，无需再次输入密码。
 * 3. 单机模式不缓存 access token（无 JWT），仅凭 masterKey 即可解密本地笔记。
 */

import { create } from 'zustand';
import {
  deriveSecrets,
  generateMasterKey,
  generateRecoveryCode,
  normalizeRecoveryCode,
  fromBase64,
  toBase64,
  randomBytes,
  wrapKey,
  unwrapKey,
  setupLocalAuth,
  unlockLocalAuth,
  recoverLocalAuth,
  recordFailedAttempt,
  recordSuccessfulAttempt,
  isLocked,
  remainingLockoutMs,
  INITIAL_LOCKOUT_STATE,
  LOCAL_LOCKOUT_DURATION_MS,
  type Ciphertext,
  type LocalAuthBlob,
  type LocalLockoutState,
} from '@dustnote/shared';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, setAccessToken } from '../api';
import { useModeStore } from '../lib/mode-store';
import {
  loadLocalAuthBlob,
  saveLocalAuthBlob,
  loadLockoutState,
  saveLockoutState,
  clearLockoutState,
} from '../lib/local-auth-storage';

export type AuthState = 'unknown' | 'uninitialized' | 'needs_unlock' | 'unlocked';

const MASTER_KEYCHAIN_SERVICE = 'dustnote.master';
const ACCESS_TOKEN_KEY = 'dustnote_access_token';

/** 将 masterKey 以生物识别访问控制写入 keychain
 *
 * 安全取舍：使用 BIOMETRY_CURRENT_SET（不允许回退到设备 PIN），避免攻击者通过
 * 弱 PIN 解封 masterKey。生物识别不可用或失败时，由 UI 引导用户回退到密码输入。
 * 代价：无生物识别的设备无法使用此缓存，每次都需输入主密码——这是 E2EE 应用的合理取舍。
 */
async function cacheMasterKeyForBiometric(masterKey: Uint8Array): Promise<void> {
  await Keychain.setGenericPassword('master', toBase64(masterKey), {
    service: MASTER_KEYCHAIN_SERVICE,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/** 读取缓存的 masterKey（受生物识别保护）；失败/不存在返回 null */
async function readCachedMasterKey(): Promise<Uint8Array | null> {
  try {
    const creds = await Keychain.getGenericPassword({ service: MASTER_KEYCHAIN_SERVICE });
    if (!creds) return null;
    return fromBase64(creds.password);
  } catch {
    return null;
  }
}

interface AuthStoreState {
  authState: AuthState;
  accessToken: string | null;
  masterKey: Uint8Array | null;
  deviceId: string | null;
  /** 服务端下发的 pwSalt（base64），派生 KEK 用 */
  pwSalt: string | null;
  /** keychain 中是否有缓存的 masterKey（可用于生物识别） */
  hasBiometricCache: boolean;

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
  setup: (password: string) => Promise<string>;
  unlock: (password: string) => Promise<void>;
  unlockWithBiometric: () => Promise<boolean>;

  // actions: 单机模式
  /** 单机模式：检查本地鉴权状态 */
  checkStatusStandalone: () => Promise<void>;
  /** 单机模式：首次设置主密码；返回恢复码 */
  setupStandalone: (password: string) => Promise<string>;
  /** 单机模式：解锁 */
  unlockStandalone: (password: string) => Promise<void>;
  /** 单机模式：生物识别解锁（读取 keychain 中缓存的 masterKey） */
  unlockStandaloneWithBiometric: () => Promise<boolean>;
  /** 单机模式：恢复码重置密码；返回新恢复码 */
  recoverStandalone: (recoveryCode: string, newPassword: string) => Promise<string>;
  /** 单机模式：获取剩余锁定时间（ms） */
  getRemainingLockoutMs: () => number;
}

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  authState: 'unknown',
  accessToken: null,
  masterKey: null,
  deviceId: null,
  pwSalt: null,
  hasBiometricCache: false,
  localAuthBlob: null,
  lockoutState: { ...INITIAL_LOCKOUT_STATE },

  // ========== 通用 actions ==========

  async init() {
    const { mode, initialized } = useModeStore.getState();
    // 模式未选择时保持 unknown 状态，等待用户选择
    if (!initialized) {
      set({ authState: 'unknown' });
      return;
    }

    if (mode === 'standalone') {
      try {
        await get().checkStatusStandalone();
      } catch (e) {
        // 单机模式不应失败（无网络），任何异常都视为存储损坏
        console.warn('[auth] checkStatusStandalone failed', e);
        set({ authState: 'uninitialized' });
      }
      return;
    }

    // 联机模式：检查服务端状态
    try {
      const r = await api.get<{
        initialized: boolean;
        deviceKnown: boolean;
        pwSalt: string | null;
      }>('/auth/status');
      set({ pwSalt: r.pwSalt });
      if (!r.initialized) {
        set({ authState: 'uninitialized' });
        return;
      }
      // 尝试探测 keychain 是否有缓存的 masterKey（不触发生物识别）
      // 注：getGenericPassword 在设置了 ACCESS_CONTROL 时会触发生物识别弹窗，
      // 这里仅用 hasGenericPassword 之类的轻量探测；如不可用则保守地假设有缓存。
      let hasCache = false;
      try {
        // canImplyAuthentication 在某些 ROM 上会抛 IllegalStateException，加超时保护
        const ok = await Promise.race([
          Keychain.canImplyAuthentication({ service: MASTER_KEYCHAIN_SERVICE }),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500)),
        ]);
        hasCache = ok === true;
      } catch (e) {
        console.warn('[auth] Keychain.canImplyAuthentication failed', e);
        hasCache = false;
      }
      set({ authState: 'needs_unlock', hasBiometricCache: hasCache });
    } catch (e) {
      // 服务端不可达：保持 unknown 让 UI 提示用户
      console.warn('[auth] /auth/status failed', e);
      set({ authState: 'unknown' });
    }
  },

  lock() {
    const k = get().masterKey;
    if (k) k.fill(0);
    setAccessToken(null);
    set({
      authState: 'needs_unlock',
      masterKey: null,
      // 单机模式锁定时也清空内存中的 blob（保留持久化层），下次重新从存储加载
      localAuthBlob: null,
    });
  },

  setAccessToken(token: string) {
    setAccessToken(token);
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

    const r = await api.post<{ accessToken: string; userId: string; deviceId: string }>(
      '/auth/setup',
      {
        // 主密码不出客户端，服务端只拿到 authKey 和密文
        authKey: toBase64(pw.authKey),
        recoveryAuthKey: toBase64(rc.authKey),
        wrappedMasterKeyPw: wrappedPw,
        wrappedMasterKeyRc: wrappedRc,
        pwSalt: toBase64(pwSalt),
        rcSalt: toBase64(rcSalt),
        deviceName: 'Android 客户端',
      }
    );

    // 缓存 masterKey 到 keychain（生物识别保护），便于后续指纹 / 面容解锁
    await cacheMasterKeyForBiometric(masterKey);

    setAccessToken(r.accessToken);
    set({
      authState: 'unlocked',
      accessToken: r.accessToken,
      masterKey,
      deviceId: r.deviceId,
      pwSalt: toBase64(pwSalt),
      hasBiometricCache: true,
    });
    return recoveryCode;
  },

  async unlock(password: string): Promise<void> {
    // v2：pwSalt 在 init 时已拿到；兜底再取一次
    let salt = get().pwSalt;
    if (!salt) {
      const status = await api.get<{ pwSalt: string | null }>('/auth/status');
      salt = status.pwSalt;
      if (!salt) throw new Error('系统未初始化');
    }

    const pw = await deriveSecrets(password, fromBase64(salt));
    const r = await api.post<{
      accessToken: string;
      userId: string;
      deviceId: string;
      wrappedMasterKey: Ciphertext;
    }>('/auth/unlock', { authKey: toBase64(pw.authKey), deviceName: 'Android 客户端' });

    // masterKey 只能在本地解封出来，服务端无从得知
    const masterKey = await unwrapKey(pw.kek, r.wrappedMasterKey);

    // 密码解锁成功后，刷新 keychain 中的 masterKey 缓存
    await cacheMasterKeyForBiometric(masterKey);

    setAccessToken(r.accessToken);
    set({
      authState: 'unlocked',
      accessToken: r.accessToken,
      masterKey,
      deviceId: r.deviceId,
      pwSalt: salt,
      hasBiometricCache: true,
    });
  },

  async unlockWithBiometric(): Promise<boolean> {
    // 读取 keychain 中受生物识别保护的 masterKey
    const masterKey = await readCachedMasterKey();
    if (!masterKey) return false;

    // 复用 AsyncStorage 中持久化的 access token（密码解锁时已写入）
    const token = await AsyncStorage.getItem(ACCESS_TOKEN_KEY);
    if (!token) return false;

    setAccessToken(token);
    set({
      authState: 'unlocked',
      accessToken: token,
      masterKey,
      deviceId: null,
      hasBiometricCache: true,
    });
    return true;
  },

  // ========== 单机模式 actions ==========

  async checkStatusStandalone(): Promise<void> {
    const blob = await loadLocalAuthBlob();
    const lockout = await loadLockoutState();
    if (!blob) {
      set({ authState: 'uninitialized', lockoutState: lockout });
      return;
    }

    // 探测 keychain 是否有缓存的 masterKey（不触发生物识别弹窗）
    let hasCache = false;
    try {
      const ok = await Promise.race([
        Keychain.canImplyAuthentication({ service: MASTER_KEYCHAIN_SERVICE }),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500)),
      ]);
      hasCache = ok === true;
    } catch {
      hasCache = false;
    }

    // 已设置过主密码，需要解锁（即使锁定也走解锁页，由 UI 显示倒计时）
    set({
      authState: 'needs_unlock',
      localAuthBlob: blob,
      lockoutState: lockout,
      hasBiometricCache: hasCache,
    });
  },

  async setupStandalone(password: string): Promise<string> {
    const result = await setupLocalAuth(password);
    await saveLocalAuthBlob(result.blob);
    await clearLockoutState();
    // 缓存 masterKey 到 keychain（生物识别保护），便于后续指纹 / 面容解锁
    try {
      await cacheMasterKeyForBiometric(result.masterKey);
    } catch {
      // keychain 不可用（如模拟器无生物识别）不阻塞流程
    }
    set({
      localAuthBlob: result.blob,
      masterKey: result.masterKey,
      lockoutState: { ...INITIAL_LOCKOUT_STATE },
      authState: 'unlocked',
      hasBiometricCache: true,
    });
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
      await saveLockoutState(newState);
      set({ lockoutState: newState });
      if (isLocked(newState)) {
        throw new Error(
          `密码错误次数过多，账号已锁定 ${LOCAL_LOCKOUT_DURATION_MS / 60000} 分钟`
        );
      }
      throw new Error('主密码错误');
    }

    const successState = recordSuccessfulAttempt();
    await saveLockoutState(successState);
    // 密码解锁成功后，刷新 keychain 中的 masterKey 缓存
    try {
      if (result.masterKey) {
        await cacheMasterKeyForBiometric(result.masterKey);
      }
    } catch {
      // keychain 不可用不阻塞流程
    }
    set({
      masterKey: result.masterKey,
      lockoutState: successState,
      authState: 'unlocked',
      hasBiometricCache: true,
    });
  },

  async unlockStandaloneWithBiometric(): Promise<boolean> {
    const { lockoutState } = get();
    // 锁定中不允许生物识别绕过（与密码解锁共用同一锁定状态）
    if (isLocked(lockoutState)) {
      const remaining = remainingLockoutMs(lockoutState);
      throw new Error(`账号已锁定，请 ${Math.ceil(remaining / 1000)} 秒后重试`);
    }

    // 读取 keychain 中受生物识别保护的 masterKey
    const masterKey = await readCachedMasterKey();
    if (!masterKey) return false;

    const successState = recordSuccessfulAttempt();
    await saveLockoutState(successState);
    set({
      masterKey,
      lockoutState: successState,
      authState: 'unlocked',
      hasBiometricCache: true,
    });
    return true;
  },

  async recoverStandalone(recoveryCode: string, newPassword: string): Promise<string> {
    const { localAuthBlob } = get();
    if (!localAuthBlob) throw new Error('未初始化');
    const result = await recoverLocalAuth(recoveryCode, newPassword, localAuthBlob);
    if (!result.success || !result.blob || !result.masterKey || !result.recoveryCode) {
      throw new Error('恢复码错误');
    }
    await saveLocalAuthBlob(result.blob);
    await clearLockoutState();
    // 恢复后 masterKey 可能已变更，刷新 keychain 缓存
    try {
      await cacheMasterKeyForBiometric(result.masterKey);
    } catch {
      // keychain 不可用不阻塞流程
    }
    set({
      localAuthBlob: result.blob,
      masterKey: result.masterKey,
      lockoutState: { ...INITIAL_LOCKOUT_STATE },
      authState: 'unlocked',
      hasBiometricCache: true,
    });
    return result.recoveryCode;
  },

  getRemainingLockoutMs(): number {
    return remainingLockoutMs(get().lockoutState);
  },
}));
