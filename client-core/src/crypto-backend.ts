/**
 * CryptoBackend —— 跨端加密适配器接口（架构改进 #2）
 *
 * 背景：
 * shared/crypto.ts 内部已用 hasWebCryptoSubtle() + setSecureRandomSource()
 * 做了平台自动嗅探，但这是「全局副作用式」的：不可注入、不可 mock、
 * 平台要切到全原生实现（如 Tauri Rust AES、RN quick-crypto createHmac）
 * 只能靠改全局对象。每换一个端都得重新踩一遍原生坑，且没有干净的接缝。
 *
 * 本模块把 client-core 需要的加密能力收敛成一个显式、可注入的接口：
 * - 默认实现 sharedCryptoBackend 委托给 @dustnote/shared（在所有 shared
 *   能跑的平台上直接可用，行为与现有 web/store.ts 完全一致）。
 * - 平台可调用 setCryptoBackend() 注入原生后端，把差异收进适配器，
 *   而不是每端临时 patch 全局。
 * - 测试可注入 mock 后端，无需触碰 WebCrypto / Argon2。
 *
 * 设计取舍：不做「重新实现一套 crypto」。shared 已经是单一密码学真相源，
 * 这里只做「显式接缝 + 可注入」，避免版本漂移与双重维护。
 */

import {
  encryptString,
  decryptString,
  noteAad,
  randomBytes,
  type Ciphertext,
} from '@dustnote/shared';

/**
 * 客户端内核依赖的加密能力契约。
 *
 * envelope / conflict / sync-engine 只依赖这一层，不直接 import shared 的
 * 具体 crypto 函数，从而与平台后端解耦。
 */
export interface CryptoBackend {
  /** 密码学安全随机字节 */
  randomBytes(n: number): Uint8Array;
  /** AES-GCM 加密字符串，返回 Ciphertext 信封 blob */
  encryptString(
    key: Uint8Array,
    plaintext: string,
    keyVersion?: number,
    aad?: Uint8Array
  ): Promise<Ciphertext>;
  /** AES-GCM 解密字符串；AAD 不匹配抛错 */
  decryptString(
    key: Uint8Array,
    blob: Ciphertext,
    aad?: Uint8Array
  ): Promise<string>;
  /** 构造 AAD：`entityId||userId`，防密文重排 */
  noteAad(entityId: string, userId: string): Uint8Array;
}

/**
 * 默认后端：委托给 @dustnote/shared。
 *
 * 在 web / 桌面 / Node 20+ 上走 WebCrypto，在无 WebCrypto 的小程序上走
 * noble 纯 JS 回退，在 RN 上走 quick-crypto —— 全部由 shared 内部嗅探决定，
 * 行为与重构前的 web/store.ts 完全一致，零行为变更。
 */
export const sharedCryptoBackend: CryptoBackend = {
  randomBytes,
  encryptString,
  decryptString,
  noteAad,
};

let activeBackend: CryptoBackend = sharedCryptoBackend;

/** 取当前生效的加密后端（envelope 等模块默认用它） */
export function getCryptoBackend(): CryptoBackend {
  return activeBackend;
}

/**
 * 注入平台专属加密后端。
 *
 * 各端在启动时调用一次：
 * - RN：注入基于 react-native-quick-crypto 原生 JSI 的后端
 * - Taro 小程序：注入带 wx 安全随机源的后端
 * - Tauri 桌面（可选）：注入 Rust 侧 AES 后端以获得硬件加速
 * - 测试：注入 mock 后端
 */
export function setCryptoBackend(backend: CryptoBackend): void {
  activeBackend = backend;
}
