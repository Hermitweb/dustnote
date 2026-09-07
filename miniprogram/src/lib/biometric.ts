/**
 * 指纹解锁（微信 SOTER）——平台专门优化
 *
 * 平台差异与安全取舍（用户已确认接受）：
 * 微信无 Keychain/Keystore 级访问控制，masterKey 以 base64 存本地 storage，
 * SOTER 指纹验证通过才读取——门禁是设备生物识别，存储弱于安卓 Keystore。
 *
 * 专门优化：
 * - 前置双检（checkIsSupportSoterAuthentication + checkIsSoterEnrolledInDevice），
 *   任一不满足即不可用；结果会话内缓存，避免解锁页每次重复调用
 * - 「已启用」开关独立于密钥缓存：关开关即清缓存，开开关当次验证后写入
 * - 每次密码解锁成功后（auth store）自动续写缓存，保证缓存与账号最新密钥一致
 * - lock()（手动锁屏）不清缓存：指纹重新验证即可恢复，无需重输主密码
 */
import Taro from '@tarojs/taro';
import { fromBase64, toBase64 } from '@dustnote/shared';

const CACHE_KEY = 'dustnote_biometric_mk';
const ENABLED_KEY = 'dustnote_biometric_enabled';

let supportCache: boolean | null = null;

/** 设备是否支持且已录入指纹（会话内缓存检测结果） */
export async function isBiometricSupported(): Promise<boolean> {
  if (supportCache !== null) return supportCache;
  try {
    if (typeof Taro.checkIsSupportSoterAuthentication !== 'function') {
      supportCache = false;
      return false;
    }
    const sup = await Taro.checkIsSupportSoterAuthentication();
    if (!sup.supportMode?.includes('fingerPrint')) {
      supportCache = false;
      return false;
    }
    if (typeof Taro.checkIsSoterEnrolledInDevice !== 'function') {
      supportCache = false;
      return false;
    }
    const enrolled = await Taro.checkIsSoterEnrolledInDevice({ checkAuthMode: 'fingerPrint' });
    supportCache = !!enrolled.isEnrolled;
    return supportCache;
  } catch {
    supportCache = false;
    return false;
  }
}

/** 用户是否已开启指纹解锁 */
export function isBiometricEnabled(): boolean {
  try {
    return !!Taro.getStorageSync(ENABLED_KEY);
  } catch {
    return false;
  }
}

export function setBiometricEnabled(enabled: boolean): void {
  try {
    Taro.setStorageSync(ENABLED_KEY, enabled);
  } catch {
    /* ignore */
  }
  if (!enabled) clearCachedMasterKey();
}

/** 密码解锁成功后续写缓存（保证缓存与账号当前 masterKey 一致） */
export function cacheMasterKeyForBiometric(masterKey: Uint8Array): void {
  try {
    Taro.setStorageSync(CACHE_KEY, toBase64(masterKey));
  } catch {
    /* ignore */
  }
}

/** 读取缓存的 masterKey（仅应在 SOTER 验证通过后调用） */
export function readCachedMasterKey(): Uint8Array | null {
  try {
    const b64 = Taro.getStorageSync(CACHE_KEY) as string;
    return b64 ? fromBase64(b64) : null;
  } catch {
    return null;
  }
}

export function clearCachedMasterKey(): void {
  try {
    Taro.removeStorageSync(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/** 弹出指纹验证；resolve true = 验证通过（取消/失败均 false） */
export function promptBiometric(): Promise<boolean> {
  return new Promise((resolve) => {
    Taro.startSoterAuthentication({
      requestAuthModes: ['fingerPrint'],
      challenge: 'dustnote-unlock-' + Date.now(),
      authContent: '解锁尘渊笔记',
      success: () => resolve(true),
      fail: () => resolve(false),
    });
  });
}
