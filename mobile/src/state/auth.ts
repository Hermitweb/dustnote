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
import { Alert } from 'react-native';
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
  KDF_PARAMS_MOBILE,
  KDF_VERSION,
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
import {
  consumePendingMigration,
  loadPendingMigration,
  persistWrappedOldMasterKey,
} from '../lib/migration';

export type AuthState = 'unknown' | 'uninitialized' | 'needs_unlock' | 'unlocked';

const MASTER_KEYCHAIN_SERVICE = 'dustnote.master';
const ACCESS_TOKEN_KEY = 'dustnote_access_token';
const USER_ID_KEY = 'dustnote_user_id';

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
  /** 用户 ID（用于笔记密文 AAD 绑定 noteId||userId，§2.2；单机模式为 null） */
  userId: string | null;
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
  /** setup / recover 完成后由用户确认已保存恢复码，再切到 unlocked 状态。
   *  setup* / recoverStandalone 不再自动设 unlocked，否则 App.tsx 会立即路由到
   *  主界面，导致恢复码界面被卸载、用户永远看不到恢复码。 */
  confirmSetupComplete: () => void;

  // actions: 联机模式
  setup: (password: string) => Promise<string>;
  unlock: (password: string, totpCode?: string) => Promise<void>;
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

  // ========== 模式切换迁移 ==========
  /** 模式迁移时保留的旧 masterKey（内存副本，lock() 不清除；迁移导入完成后清零） */
  pendingMasterKey: Uint8Array | null;
  /** 设置待迁移的旧 masterKey（内部拷贝，避免 lock() 清零影响） */
  setPendingMasterKey: (key: Uint8Array | null) => void;

  // ========== 账户操作 ==========
  /** 联机模式：修改主密码（验证当前密码 → 派生新 KEK → rewrap） */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** 单机模式：修改主密码；返回新恢复码 */
  changePasswordStandalone: (currentPassword: string, newPassword: string) => Promise<string>;
  /** 联机模式：恢复码重置密码（masterKey 不变，随后用新密码 rewrap） */
  recoverOnline: (recoveryCode: string, newPassword: string) => Promise<void>;
}

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  authState: 'unknown',
  accessToken: null,
  masterKey: null,
  deviceId: null,
  pwSalt: null,
  userId: null,
  hasBiometricCache: false,
  localAuthBlob: null,
  lockoutState: { ...INITIAL_LOCKOUT_STATE },
  pendingMasterKey: null,

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
    // 不清除 AsyncStorage 中的 token 和 userId —— 生物识别解锁需要它们
    // token 会随 HTTP-only cookie 过期自动失效，无需手动清除
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

  confirmSetupComplete() {
    // setup* / recoverStandalone 已把 masterKey / blob 等写入 store，
    // 但保留了 authState（uninitialized / needs_unlock）以便恢复码界面继续显示。
    // 用户确认已保存恢复码后调用此方法，切到 unlocked 触发 App.tsx 路由到主界面。
    set({ authState: 'unlocked' });
  },

  // ========== 联机模式 actions ==========

  async setup(password: string): Promise<string> {
    // v2：masterKey 随机生成，与密码解耦；换密码时只换包装，不动笔记
    const masterKey = generateMasterKey();
    const recoveryCode = generateRecoveryCode();
    const pwSalt = randomBytes(16);
    const rcSalt = randomBytes(16);

    const pw = await deriveSecrets(password, pwSalt, KDF_PARAMS_MOBILE);
    const rc = await deriveSecrets(normalizeRecoveryCode(recoveryCode), rcSalt, KDF_PARAMS_MOBILE);
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
    // 注意：此处不设置 authState: 'unlocked'！
    // setup 返回 recoveryCode 后 SetupScreen 需展示恢复码，
    // 提前切 'unlocked' 会导致 App.tsx 立即路由到主界面，恢复码界面被卸载。
    // 用户点击「我已保存」→ confirmSetupComplete() → authState='unlocked'。
    set({
      accessToken: r.accessToken,
      masterKey,
      deviceId: r.deviceId,
      pwSalt: toBase64(pwSalt),
      userId: r.userId,
      hasBiometricCache: true,
    });
    // 持久化 userId（生物识别解锁时恢复，用于笔记 AAD 绑定）
    void AsyncStorage.setItem(USER_ID_KEY, r.userId).catch(() => undefined);
    // 模式迁移：新模式 setup 成功后自动导入待迁移数据
    await runPendingMigration();
    return recoveryCode;
  },

  async unlock(password: string, totpCode?: string): Promise<void> {
    // v2：pwSalt 在 init 时已拿到；兜底再取一次
    let salt = get().pwSalt;
    if (!salt) {
      const status = await api.get<{ pwSalt: string | null }>('/auth/status');
      salt = status.pwSalt;
      if (!salt) throw new Error('系统未初始化');
    }

    const pw = await deriveSecrets(password, fromBase64(salt), KDF_PARAMS_MOBILE);
    const body: { authKey: string; deviceName: string; totpCode?: string } = {
      authKey: toBase64(pw.authKey),
      deviceName: 'Android 客户端',
    };
    if (totpCode) body.totpCode = totpCode;
    const r = await api.post<{
      accessToken: string;
      userId: string;
      deviceId: string;
      wrappedMasterKey: Ciphertext;
    }>('/auth/unlock', body);

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
      userId: r.userId,
      hasBiometricCache: true,
    });
    // 持久化 userId（生物识别解锁时恢复，用于笔记 AAD 绑定）
    void AsyncStorage.setItem(USER_ID_KEY, r.userId).catch(() => undefined);
    // 模式迁移：新模式解锁成功后自动导入待迁移数据
    await runPendingMigration();
  },

  async unlockWithBiometric(): Promise<boolean> {
    // 读取 keychain 中受生物识别保护的 masterKey
    const masterKey = await readCachedMasterKey();
    if (!masterKey) return false;

    // 复用 AsyncStorage 中持久化的 access token（密码解锁时已写入）
    const token = await AsyncStorage.getItem(ACCESS_TOKEN_KEY);
    if (!token) return false;
    const userId = await AsyncStorage.getItem(USER_ID_KEY);

    setAccessToken(token);
    set({
      authState: 'unlocked',
      accessToken: token,
      masterKey,
      deviceId: null,
      userId,
      hasBiometricCache: true,
    });
    void runPendingMigration();
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
    // 使用移动端降级 KDF 参数（8MB），避免 64MB Argon2id 阻塞 Hermes 主线程
    const result = await setupLocalAuth(password, KDF_PARAMS_MOBILE);
    await saveLocalAuthBlob(result.blob);
    await clearLockoutState();
    // 缓存 masterKey 到 keychain（生物识别保护），便于后续指纹 / 面容解锁
    try {
      await cacheMasterKeyForBiometric(result.masterKey);
    } catch {
      // keychain 不可用（如模拟器无生物识别）不阻塞流程
    }
    // 注意：此处不设置 authState: 'unlocked'！
    // setupStandalone 返回 recoveryCode 后 StandaloneSetupScreen 需展示恢复码，
    // 提前切 'unlocked' 会导致 App.tsx 立即路由到主界面，恢复码界面被卸载。
    // 用户点击「我已保存」→ confirmSetupComplete() → authState='unlocked'。
    set({
      localAuthBlob: result.blob,
      masterKey: result.masterKey,
      lockoutState: { ...INITIAL_LOCKOUT_STATE },
      hasBiometricCache: true,
    });
    // 模式迁移：新模式下首次设置成功后自动导入待迁移数据
    await runPendingMigration();
    return result.recoveryCode;
  },

  async unlockStandalone(password: string): Promise<void> {
    const { localAuthBlob, lockoutState } = get();
    // lock() 会清空内存中的 localAuthBlob；从持久化层兜底重新加载，
    // 否则锁屏后（杀进程前）无论密码是否正确都报「未初始化」，只能重启 App
    const blob = localAuthBlob ?? (await loadLocalAuthBlob());
    if (!blob) throw new Error('未初始化');
    if (isLocked(lockoutState)) {
      const remaining = remainingLockoutMs(lockoutState);
      throw new Error(`账号已锁定，请 ${Math.ceil(remaining / 1000)} 秒后重试`);
    }

    const result = await unlockLocalAuth(password, blob, KDF_PARAMS_MOBILE);
    if (!result.success) {
      const newState = recordFailedAttempt(lockoutState);
      await saveLockoutState(newState);
      set({ lockoutState: newState });
      if (isLocked(newState)) {
        throw new Error(`密码错误次数过多，账号已锁定 ${LOCAL_LOCKOUT_DURATION_MS / 60000} 分钟`);
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
      localAuthBlob: blob,
      lockoutState: successState,
      authState: 'unlocked',
      hasBiometricCache: true,
    });
    // 模式迁移：新模式解锁成功后自动导入待迁移数据
    await runPendingMigration();
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
    void runPendingMigration();
    return true;
  },

  async recoverStandalone(recoveryCode: string, newPassword: string): Promise<string> {
    const { localAuthBlob } = get();
    // 与 unlockStandalone 一致：lock() 清空内存 blob 后从持久化层兜底重新加载
    const blob = localAuthBlob ?? (await loadLocalAuthBlob());
    if (!blob) throw new Error('未初始化');
    const result = await recoverLocalAuth(recoveryCode, newPassword, blob, KDF_PARAMS_MOBILE);
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
    // 注意：此处不设置 authState: 'unlocked'！
    // recoverStandalone 返回新 recoveryCode 后 StandaloneRecoverScreen 需展示，
    // 提前切 'unlocked' 会导致 App.tsx 立即路由到主界面，恢复码界面被卸载。
    // 用户点击「我已保存」→ confirmSetupComplete() → authState='unlocked'。
    set({
      localAuthBlob: result.blob,
      masterKey: result.masterKey,
      lockoutState: { ...INITIAL_LOCKOUT_STATE },
      hasBiometricCache: true,
    });
    return result.recoveryCode;
  },

  getRemainingLockoutMs(): number {
    return remainingLockoutMs(get().lockoutState);
  },

  // ========== 模式切换迁移 ==========

  setPendingMasterKey(key: Uint8Array | null): void {
    // 拷贝一份：调用方传入的是 store 中正被使用的 masterKey，随后 lock() 会将其清零
    set({ pendingMasterKey: key ? new Uint8Array(key) : null });
  },

  // ========== 账户操作 ==========

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) throw new Error('新主密码至少 8 字符');
    // 1. 用当前密码 unlock 验证身份 + 取回服务端 wrapped masterKey（同时刷新会话）
    let salt = get().pwSalt;
    if (!salt) {
      const status = await api.get<{ pwSalt: string | null }>('/auth/status');
      salt = status.pwSalt;
      if (!salt) throw new Error('系统未初始化');
    }
    const pw = await deriveSecrets(currentPassword, fromBase64(salt), KDF_PARAMS_MOBILE);
    const r = await api.post<{
      accessToken: string;
      userId: string;
      deviceId: string;
      wrappedMasterKey: Ciphertext;
    }>('/auth/unlock', { authKey: toBase64(pw.authKey), deviceName: 'Android 客户端' });
    const masterKey = await unwrapKey(pw.kek, r.wrappedMasterKey);

    // 2. 新密码派生新 KEK，重新包装同一把 masterKey（masterKey 不变，笔记照常可解）
    const newPwSalt = randomBytes(16);
    const np = await deriveSecrets(newPassword, newPwSalt, KDF_PARAMS_MOBILE);
    const wrappedPw = await wrapKey(np.kek, masterKey);

    // 3. 上传新包装（rewrap 需要鉴权，先落 token）
    setAccessToken(r.accessToken);
    await api.post('/auth/rewrap', {
      password: {
        authKey: toBase64(np.authKey),
        salt: toBase64(newPwSalt),
        wrappedMasterKey: wrappedPw,
      },
    });

    // 4. 更新本地状态 + keychain 缓存
    await cacheMasterKeyForBiometric(masterKey);
    set({
      accessToken: r.accessToken,
      masterKey,
      deviceId: r.deviceId,
      pwSalt: toBase64(newPwSalt),
      userId: r.userId,
    });
    void AsyncStorage.setItem(USER_ID_KEY, r.userId).catch(() => undefined);
  },

  async changePasswordStandalone(currentPassword: string, newPassword: string): Promise<string> {
    if (newPassword.length < 8) throw new Error('新主密码至少 8 字符');
    const { localAuthBlob, lockoutState } = get();
    const blob = localAuthBlob ?? (await loadLocalAuthBlob());
    if (!blob) throw new Error('未初始化');
    if (isLocked(lockoutState)) {
      const remaining = remainingLockoutMs(lockoutState);
      throw new Error('账号已锁定，请 ' + Math.ceil(remaining / 1000) + ' 秒后重试');
    }
    const result = await unlockLocalAuth(currentPassword, blob, KDF_PARAMS_MOBILE);
    if (!result.success || !result.masterKey) {
      throw new Error('当前密码错误');
    }
    // 用同一把 masterKey + 新密码重新包装（新恢复码随之生成，旧恢复码失效）
    const newAuth = await buildLocalAuthBlobForMasterKey(result.masterKey, newPassword);
    await saveLocalAuthBlob(newAuth.blob);
    await clearLockoutState();
    try {
      await cacheMasterKeyForBiometric(result.masterKey);
    } catch {
      // keychain 不可用不阻塞流程
    }
    set({
      localAuthBlob: newAuth.blob,
      lockoutState: { ...INITIAL_LOCKOUT_STATE },
    });
    return newAuth.recoveryCode;
  },

  async recoverOnline(recoveryCode: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) throw new Error('新主密码至少 8 字符');
    // v2：先取恢复码派生所需的 rc_salt（盐不是秘密，无需鉴权）
    const { rcSalt } = await api.get<{ rcSalt: string }>('/auth/recovery-params');
    const rc = await deriveSecrets(normalizeRecoveryCode(recoveryCode), fromBase64(rcSalt), KDF_PARAMS_MOBILE);

    const r = await api.post<{
      accessToken: string;
      userId: string;
      deviceId: string;
      wrappedMasterKey: Ciphertext;
    }>('/auth/recover', {
      recoveryAuthKey: toBase64(rc.authKey),
      deviceName: 'Android 客户端（恢复）',
    });

    // 关键：解封出来的是原来那把 masterKey，历史笔记照常能解开
    const masterKey = await unwrapKey(rc.kek, r.wrappedMasterKey);

    // 拿回 masterKey 后立刻用新密码重新包装（masterKey 本身不变）
    const newPwSalt = randomBytes(16);
    const pw = await deriveSecrets(newPassword, newPwSalt, KDF_PARAMS_MOBILE);
    const wrappedPw = await wrapKey(pw.kek, masterKey);

    // 先落 token，rewrap 是需要鉴权的接口
    setAccessToken(r.accessToken);
    await api.post('/auth/rewrap', {
      password: {
        authKey: toBase64(pw.authKey),
        salt: toBase64(newPwSalt),
        wrappedMasterKey: wrappedPw,
      },
    });

    await cacheMasterKeyForBiometric(masterKey);
    set({
      authState: 'unlocked',
      accessToken: r.accessToken,
      masterKey,
      deviceId: r.deviceId,
      pwSalt: toBase64(newPwSalt),
      userId: r.userId,
      hasBiometricCache: true,
    });
    void AsyncStorage.setItem(USER_ID_KEY, r.userId).catch(() => undefined);
    // 恢复也可能作为模式迁移的完成路径（standalone→online 已有账户），一并消费
    await runPendingMigration();
  },
}));

// ========== 模式迁移 / 改密辅助 ==========

/**
 * 为指定 masterKey 构造单机模式 LocalAuthBlob（修改主密码 / 模式迁移复用）。
 * masterKey 保持不变的场景，用新密码 + 新恢复码重新包装同一把 masterKey。
 */
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
    kdfParams: {
      algorithm: 'pbkdf2',
      m: KDF_PARAMS_MOBILE.m,
      t: KDF_PARAMS_MOBILE.t,
      p: KDF_PARAMS_MOBILE.p,
      iterations: KDF_PARAMS_MOBILE.iterations,
      dkLen: KDF_PARAMS_MOBILE.dkLen,
    },
    createdAt: new Date().toISOString(),
  };
  return { blob, recoveryCode };
}

/**
 * 消费模式切换遗留的待迁移数据（新模式 setup / unlock / recover 成功后调用）。
 * 无待迁移数据时快速返回；导入成功后清零 pending masterKey。
 */
async function runPendingMigration(): Promise<void> {
  const { masterKey, pendingMasterKey } = useAuthStore.getState();
  if (!masterKey) return;
  const slot = await loadPendingMigration();
  if (!slot) return;

  // 内存中没有旧 masterKey 时，尝试从 slot 解封（上次导入失败已持久化包装）
  let oldKey: Uint8Array | null = pendingMasterKey;
  if (!oldKey && slot.wrappedOldMasterKey) {
    try {
      oldKey = await unwrapKey(masterKey, slot.wrappedOldMasterKey);
    } catch {
      oldKey = null;
    }
  }
  if (!oldKey) return; // 无旧 key，无法解密备份，等待下次解锁重试

  // 先把旧 masterKey 用当前 masterKey 包装持久化：即使导入中途 App 被杀，重启后仍可重试
  await persistWrappedOldMasterKey(slot, masterKey, oldKey).catch(() => undefined);

  try {
    const res = await consumePendingMigration(masterKey, oldKey);
    if (res) {
      const msg =
        res.failed > 0
          ? '已迁移 ' + res.imported + ' 条笔记，' + res.failed + ' 条因解密失败跳过。'
          : '已迁移 ' + res.imported + ' 条笔记。';
      Alert.alert('数据迁移完成', msg);
      const k = useAuthStore.getState().pendingMasterKey;
      if (k) k.fill(0);
      useAuthStore.setState({ pendingMasterKey: null });
    }
  } catch (err) {
    // 网络等失败：wrappedOldMasterKey 已持久化，下次解锁自动重试
    console.warn('[auth] 待迁移数据导入失败，将在下次解锁时重试', err);
    Alert.alert(
      '数据迁移',
      '迁移未完成（' + (err as Error).message + '），将在下次解锁时自动重试。'
    );
  }
}
