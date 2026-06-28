/**
 * 小程序鉴权 + E2EE 加密流程
 *
 * 注意：小程序没有 localStorage / crypto.subtle 完整支持
 * - masterKey 仅存内存（刷新后清空，需重新解锁）
 * - v1 方案：复用 @dustnote/shared 的加密函数（@noble/hashes 是纯 JS）
 * - 流程对齐 web 端 store.ts：
 *   - setup：用 password 派生 masterKey，用 recoveryCode 派生 recoveryKey 包装 masterKey 后上传
 *   - unlock：用 password + 服务端下发的 clientMasterSalt 重新派生 masterKey
 *
 * 真正的强加密方案见 security.md §5.7
 */

import { create } from 'zustand';
import React from 'react';
import Taro from '@tarojs/taro';
import {
  ApiClient,
  type Ciphertext,
  deriveMasterKey,
  decryptString,
  encryptString,
  generateRecoveryCode,
  wrapMasterKey,
  deriveRecoveryKey,
  fromBase64,
  toBase64,
  randomBytes,
} from '@dustnote/shared';

const APP_VERSION = '0.1.0';

// 根据运行环境选择 API_BASE：
// - H5：相对路径，走 devServer proxy（见 config/index.ts）
// - 小程序：宿主机局域网 IP + 端口（需在微信开发者工具勾选「不校验合法域名」）
const API_BASE = process.env.TARO_ENV === 'h5'
  ? '/api/v1'
  : 'http://192.168.15.200:3210/api/v1';

// 设备 ID：首次生成后持久化到本地存储
let deviceId = '';
try {
  deviceId = Taro.getStorageSync('mn_device_id') || '';
  if (!deviceId) {
    deviceId = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    Taro.setStorageSync('mn_device_id', deviceId);
  }
} catch {
  deviceId = 'unknown';
}

export type AuthState = 'unknown' | 'uninitialized' | 'needs_unlock' | 'unlocked';

// ========== 加密信封辅助（对齐 web store.ts）==========

const ENVELOPE_VERSION = 1;

/** 笔记密文信封：服务端只存这整个对象（JSON 序列化后存 DB） */
export interface NoteCipherEnvelope {
  /** 信封版本 */
  v: number;
  /** 加密后的明文 blob（包含 title/content/tags） */
  payload: Ciphertext;
}

export interface NotePlaintext {
  title: string;
  content: string;
  tags: string[];
}

/** 加密一条笔记明文，返回信封对象及其 JSON 字符串 */
export async function encryptNote(
  key: Uint8Array,
  pt: NotePlaintext
): Promise<{ envelope: NoteCipherEnvelope; json: string }> {
  const json = JSON.stringify(pt);
  const blob = await encryptString(key, json, 1);
  const envelope: NoteCipherEnvelope = { v: ENVELOPE_VERSION, payload: blob };
  return { envelope, json: JSON.stringify(envelope) };
}

/** 用 masterKey 解密信封，得到笔记明文 */
export async function decryptNote(key: Uint8Array, envelope: NoteCipherEnvelope): Promise<NotePlaintext> {
  if (envelope.v !== ENVELOPE_VERSION) throw new Error(`envelope version mismatch: ${envelope.v}`);
  const json = await decryptString(key, envelope.payload);
  return JSON.parse(json) as NotePlaintext;
}

/** 解析服务端存的密文字符串为信封对象（兼容新旧格式） */
export function parseEnvelope(raw: string): NoteCipherEnvelope {
  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'v' in parsed &&
    'payload' in parsed
  ) {
    return parsed as NoteCipherEnvelope;
  }
  // 旧格式：直接是 Ciphertext
  if (typeof parsed === 'object' && parsed !== null && 'c' in parsed && 'n' in parsed) {
    return { v: ENVELOPE_VERSION, payload: parsed as Ciphertext };
  }
  throw new Error('invalid envelope');
}

interface AuthStoreState {
  authState: AuthState;
  accessToken: string | null;
  userId: string | null;
  /** masterKey 仅存内存，刷新后清空 */
  masterKey: Uint8Array | null;

  init: () => Promise<void>;
  setup: (password: string) => Promise<string>; // 返回 recoveryCode
  unlock: (password: string) => Promise<void>;
  setAccessToken: (token: string) => void;
  lock: () => void;
}

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  authState: 'unknown',
  accessToken: null,
  userId: null,
  masterKey: null,

  async init() {
    try {
      const r = await getApi().get<{ initialized: boolean }>('/auth/status');
      set({ authState: r.initialized ? 'needs_unlock' : 'uninitialized' });
    } catch {
      set({ authState: 'uninitialized' });
    }
  },

  async setup(password: string): Promise<string> {
    // 生成恢复码 + 客户端 masterSalt
    const recoveryCode = generateRecoveryCode();
    const clientMasterSalt = randomBytes(16);
    // 用 password 派生 masterKey
    const masterKey = await deriveMasterKey(password, clientMasterSalt);
    // 用 recoveryCode 派生 recoveryKey，包装 masterKey
    const recoverySalt = randomBytes(16);
    const recoveryKey = deriveRecoveryKey(recoveryCode, recoverySalt);
    const wrapped = await wrapMasterKey(recoveryKey, masterKey);

    const r = await getApi().post<{ accessToken: string; userId: string; deviceId: string; clientMasterSalt: string }>(
      '/auth/setup',
      {
        password,
        recoveryCode,
        wrappedMasterKey: wrapped,
        clientMasterSalt: toBase64(clientMasterSalt),
        deviceName: '小程序',
      }
    );

    persistToken(r.accessToken);
    set({
      accessToken: r.accessToken,
      userId: r.userId,
      masterKey,
      authState: 'unlocked',
    });
    return recoveryCode;
  },

  async unlock(password: string): Promise<void> {
    // 用 password 登录，服务端返回 clientMasterSalt
    const r = await getApi().post<{ accessToken: string; userId: string; deviceId: string; clientMasterSalt: string }>(
      '/auth/unlock',
      { password, deviceName: '小程序' }
    );
    // 用 password + clientMasterSalt 重新派生 masterKey
    const clientMasterSalt = fromBase64(r.clientMasterSalt);
    const masterKey = await deriveMasterKey(password, clientMasterSalt);

    persistToken(r.accessToken);
    set({
      accessToken: r.accessToken,
      userId: r.userId,
      masterKey,
      authState: 'unlocked',
    });
  },

  setAccessToken(token: string) {
    persistToken(token);
    set({ accessToken: token });
  },

  lock() {
    const k = get().masterKey;
    if (k) k.fill(0);
    set({ authState: 'needs_unlock', masterKey: null, accessToken: null });
    try { Taro.removeStorageSync('mn_access_token'); } catch { /* ignore */ }
  },
}));

// ========== API 客户端工厂 ==========

/**
 * 每次调用时读取最新的 accessToken，确保鉴权头随解锁状态变化
 * （对齐 web 端 store.ts 的 api() 工厂模式）
 */
export function getApi(): ApiClient {
  return new ApiClient({
    baseUrl: API_BASE,
    clientVersion: APP_VERSION,
    platform: 'miniprogram',
    channel: 'stable',
    deviceId,
    accessToken: useAuthStore.getState().accessToken ?? undefined,
  });
}

function persistToken(token: string): void {
  try { Taro.setStorageSync('mn_access_token', token); } catch { /* ignore */ }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const init = useAuthStore((s) => s.init);
  React.useEffect(() => { void init(); }, [init]);
  return React.createElement(React.Fragment, null, children);
}

export function useAuthInit(): AuthState {
  return useAuthStore((s) => s.authState);
}
