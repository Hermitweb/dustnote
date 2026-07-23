/**
 * 鉴权状态：uninitialized / needs_unlock / unlocked
 * masterKey 仅存内存，App 后台时自动清空
 *
 * 生物识别解锁流程：
 * 1. 首次 setup / 密码解锁成功后，将 masterKey（base64）以 BIOMETRY 访问控制
 *    写入 react-native-keychain；同时 access token 持久化到 AsyncStorage。
 * 2. 下次启动时若 keychain 有缓存，则可走生物识别：通过指纹 / 面容后，
 *    keychain 返回缓存的 masterKey，直接进入已解锁状态，无需再次输入密码。
 */

import { create } from 'zustand';
import {
  deriveMasterKey,
  generateRecoveryCode,
  fromBase64,
  toBase64,
  randomBytes,
  wrapMasterKey,
  deriveRecoveryKey,
} from '@dustnote/shared';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, setAccessToken } from '../api';

export type AuthState = 'unknown' | 'uninitialized' | 'needs_unlock' | 'unlocked';

const MASTER_KEYCHAIN_SERVICE = 'dustnote.master';
const ACCESS_TOKEN_KEY = 'dustnote_access_token';

/** 将 masterKey 以生物识别访问控制写入 keychain */
async function cacheMasterKeyForBiometric(masterKey: Uint8Array): Promise<void> {
  await Keychain.setGenericPassword('master', toBase64(masterKey), {
    service: MASTER_KEYCHAIN_SERVICE,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE,
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
  /** keychain 中是否有缓存的 masterKey（可用于生物识别） */
  hasBiometricCache: boolean;

  // actions
  init: () => Promise<void>;
  setup: (password: string) => Promise<string>;
  unlock: (password: string) => Promise<void>;
  unlockWithBiometric: () => Promise<boolean>;
  lock: () => void;
  setAccessToken: (token: string) => void;
}

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  authState: 'unknown',
  accessToken: null,
  masterKey: null,
  deviceId: null,
  hasBiometricCache: false,

  async init() {
    // 检查服务端状态
    const r = await api.get<{ initialized: boolean; deviceKnown: boolean }>('/auth/status');
    if (!r.initialized) {
      set({ authState: 'uninitialized' });
      return;
    }
    // 尝试探测 keychain 是否有缓存的 masterKey（不触发生物识别）
    // 注：getGenericPassword 在设置了 ACCESS_CONTROL 时会触发生物识别弹窗，
    // 这里仅用 hasGenericPassword 之类的轻量探测；如不可用则保守地假设有缓存。
    let hasCache = false;
    try {
      // canImplyAuthentication 不触发弹窗，仅判断 keychain 是否可用
      const ok = await Keychain.canImplyAuthentication({ service: MASTER_KEYCHAIN_SERVICE });
      hasCache = ok;
    } catch {
      hasCache = false;
    }
    set({ authState: 'needs_unlock', hasBiometricCache: hasCache });
  },

  async setup(password: string): Promise<string> {
    const recoveryCode = generateRecoveryCode();
    const clientMasterSalt = randomBytes(16);
    const masterKey = await deriveMasterKey(password, clientMasterSalt);
    const recoverySalt = randomBytes(16);
    const recoveryKey = deriveRecoveryKey(recoveryCode, recoverySalt);
    const wrapped = await wrapMasterKey(recoveryKey, masterKey);

    const r = await api.post<{
      accessToken: string;
      userId: string;
      deviceId: string;
      clientMasterSalt: string;
    }>('/auth/setup', {
      password,
      recoveryCode,
      wrappedMasterKey: wrapped,
      clientMasterSalt: toBase64(clientMasterSalt),
      deviceName: 'Android 客户端',
    });

    // 缓存 masterKey 到 keychain（生物识别保护），便于后续指纹 / 面容解锁
    await cacheMasterKeyForBiometric(masterKey);

    setAccessToken(r.accessToken);
    set({
      authState: 'unlocked',
      accessToken: r.accessToken,
      masterKey,
      deviceId: r.deviceId,
      hasBiometricCache: true,
    });
    return recoveryCode;
  },

  async unlock(password: string): Promise<void> {
    const r = await api.post<{
      accessToken: string;
      userId: string;
      deviceId: string;
      clientMasterSalt: string;
    }>('/auth/unlock', { password, deviceName: 'Android 客户端' });
    const clientMasterSalt = fromBase64(r.clientMasterSalt);
    const masterKey = await deriveMasterKey(password, clientMasterSalt);

    // 密码解锁成功后，刷新 keychain 中的 masterKey 缓存
    await cacheMasterKeyForBiometric(masterKey);

    setAccessToken(r.accessToken);
    set({
      authState: 'unlocked',
      accessToken: r.accessToken,
      masterKey,
      deviceId: r.deviceId,
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

  lock() {
    const k = get().masterKey;
    if (k) k.fill(0);
    setAccessToken(null);
    set({ authState: 'needs_unlock', masterKey: null });
  },

  setAccessToken(token: string) {
    setAccessToken(token);
    set({ accessToken: token });
  },
}));
