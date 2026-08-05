/**
 * 跨平台加密原语：Argon2id / AES-GCM / HKDF / 编码
 *
 * 设计原则：
 * - 浏览器：WebCrypto API + @noble/hashes/argon2
 * - Node 20+：同上（WebCrypto 全局可用）
 * - 同一份代码在所有平台运行
 *
 * 安全参数：
 * - Argon2id: m=64MB, t=3, p=4（OWASP 2024 推荐）
 * - AES-GCM-256
 * - nonce: 12 字节随机
 * - salt: 16 字节随机
 */

import { argon2id as nobleArgon2id } from '@noble/hashes/argon2';
import { randomBytes as nobleRandomBytes } from '@noble/hashes/utils';

// ========== 编码工具 ==========

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export function encodeUtf8(s: string): Uint8Array {
  return TEXT_ENCODER.encode(s);
}

export function decodeUtf8(b: Uint8Array): string {
  return TEXT_DECODER.decode(b);
}

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

export function toBase64Url(b: Uint8Array): string {
  return toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  // atob 要求长度是 4 的倍数，补回被去掉的 padding
  return fromBase64(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
}

export function randomBytes(n: number): Uint8Array {
  return nobleRandomBytes(n);
}

// ========== KDF（Argon2id）==========
//
// 服务端和客户端**必须**使用相同参数。

export interface KdfParams {
  /** KDF 算法，默认 'argon2id' */
  algorithm?: 'argon2id' | 'pbkdf2';
  // Argon2id 参数（algorithm='argon2id' 时使用）
  m: number;
  t: number;
  p: number;
  // PBKDF2 参数（algorithm='pbkdf2' 时使用）
  iterations?: number;
  // 通用
  dkLen: number;
}

export const KDF_PARAMS: KdfParams = {
  algorithm: 'argon2id',
  m: 64 * 1024, // 64 MB
  t: 3,
  p: 4,
  dkLen: 32,
};

/**
 * 移动端 KDF 参数（React Native / Hermes）
 *
 * 背景：@noble/hashes/argon2 是纯 JS 实现，在 Hermes 引擎（无 JIT）上
 * 执行 8MB Argon2id 需要 60+ 秒（v2.3.5 实测），完全阻塞 JS 主线程。
 * 即使降到 1MB 仍需 10+ 秒，纯 JS Argon2id 在 Hermes 上不可行。
 *
 * 最终方案：移动端使用 PBKDF2-SHA256 替代 Argon2id
 * - PBKDF2 通过 react-native-quick-crypto 的 crypto.subtle.deriveBits 实现
 *   （原生 JSI 调用 OpenSSL，不阻塞 JS 主线程）
 * - 310000 次迭代（OWASP 2023 推荐最低值）
 * - 在中端手机上约需 0.5-2 秒
 *
 * 安全取舍：PBKDF2 对 GPU/ASIC 攻击的抗性弱于 Argon2id，
 * 但对于个人笔记应用，310000 次 PBKDF2-SHA256 已足够安全。
 * 联机模式跨设备解锁时，服务端需记录每个设备的 KDF 算法版本。
 */
export const KDF_PARAMS_MOBILE: KdfParams = {
  algorithm: 'pbkdf2',
  m: 0, // Argon2id 参数不用
  t: 0,
  p: 0,
  iterations: 310000, // OWASP 2023 推荐
  dkLen: 32,
};

/**
 * 密钥派生函数
 *
 * 根据 params.algorithm 选择 Argon2id（web/小程序，纯 JS）或
 * PBKDF2（mobile，原生 JSI 通过 crypto.subtle.deriveBits）。
 *
 * 改为 async 是因为 PBKDF2 通过 crypto.subtle 异步执行。
 * Argon2id 路径保持同步，但函数签名统一为 async 以兼容两种算法。
 */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
  params = KDF_PARAMS
): Promise<Uint8Array> {
  if (params.algorithm === 'pbkdf2') {
    // PBKDF2-SHA256 via crypto.subtle.deriveBits
    // react-native-quick-crypto 提供原生 JSI 实现，不阻塞主线程
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encodeUtf8(password) as BufferSource,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt as BufferSource,
        iterations: params.iterations ?? 310000,
        hash: 'SHA-256',
      } as Pbkdf2Params,
      keyMaterial,
      params.dkLen * 8
    );
    return new Uint8Array(bits);
  }
  // 默认 Argon2id（web/小程序，纯 JS，V8 引擎下高效）
  return nobleArgon2id(password, salt, {
    m: params.m,
    t: params.t,
    p: params.p,
    dkLen: params.dkLen,
  }) as Uint8Array;
}

// ========== HKDF-SHA256 ==========

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  // react-native-quick-crypto 的 subtle.sign 未实现 HMAC（源码中 case 'HMAC' 被注释），
  // 会抛 "Unrecognized algorithm name" 错误。
  // 移动端改用 Node.js 风格的 createHmac API（react-native-quick-crypto 原生 JSI 实现）。
  // web/小程序端无 createHmac，回退到 WebCrypto subtle.sign。
  const cryptoObj = globalThis.crypto as Crypto & {
    createHmac?: (
      alg: string,
      key: BufferSource
    ) => {
      update(d: BufferSource): void;
      digest(): { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
    };
  };
  if (typeof cryptoObj.createHmac === 'function') {
    const hmac = cryptoObj.createHmac('sha256', key as BufferSource);
    hmac.update(data as BufferSource);
    const sig = hmac.digest();
    // digest() 返回 react-native-buffer 的 Buffer，可能带 byteOffset，
    // 复制到独立的 Uint8Array 避免引用整个底层 ArrayBuffer
    const result = new Uint8Array(sig.byteLength);
    result.set(new Uint8Array(sig.buffer, sig.byteOffset, sig.byteLength));
    return result;
  }

  // web/小程序端：使用 WebCrypto subtle.sign
  const ck = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign({ name: 'HMAC' }, ck, data as BufferSource);
  return new Uint8Array(sig);
}

async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  return hmacSha256(salt, ikm);
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const n = Math.ceil(length / 32);
  if (n > 255) throw new Error('hkdf: length too large');
  const out = new Uint8Array(length);
  let t = new Uint8Array(0);
  let pos = 0;
  for (let i = 1; i <= n; i++) {
    const data = new Uint8Array(t.length + info.length + 1);
    data.set(t, 0);
    data.set(info, t.length);
    data[data.length - 1] = i;
    const tNew = await hmacSha256(prk, data);
    // 重新包装为 ArrayBuffer-backed，避免 TypeScript strict generic
    t = new Uint8Array(tNew);
    const copyLen = Math.min(32, length - pos);
    out.set(t.subarray(0, copyLen), pos);
    pos += copyLen;
  }
  return out;
}

/** HKDF-SHA256 */
export async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  length = 32
): Promise<Uint8Array> {
  const prk = await hkdfExtract(salt, ikm);
  return hkdfExpand(prk, encodeUtf8(info), length);
}

// ========== 主密钥与密钥包装（协议 v2）==========
//
// 关键设计：masterKey 是**随机生成**的，不由密码派生。
//
// 密码只用来派生一把「密钥加密密钥」(KEK)，KEK 包装 masterKey 后存服务端。
// 这样改密码 / 用恢复码找回时，只需用新 KEK 重新包装同一把 masterKey，
// 历史笔记照常能解开。v1 的做法是 masterKey = f(password)，密码一变
// masterKey 就变，所有旧笔记直接成了解不开的密文（数据永久丢失）。
//
// 同一份 KDF 输出还会派生一把 authKey 上传给服务端做身份校验，
// 服务端因此**永远拿不到主密码**，也就无法自行推导 masterKey。

export const KDF_VERSION = 2;
/** KEK 的 HKDF info，用于包装/解封 masterKey */
export const KEK_INFO = `dustnote-kek-v${KDF_VERSION}`;
/** authKey 的 HKDF info，用于向服务端证明身份 */
export const AUTH_INFO = `dustnote-auth-v${KDF_VERSION}`;

export interface DerivedSecrets {
  /** 包装/解封 masterKey 用，绝不离开客户端 */
  kek: Uint8Array;
  /** 上传给服务端做身份校验，泄露它也解不开笔记 */
  authKey: Uint8Array;
}

/**
 * 从一个低熵秘密（主密码或恢复码）派生 KEK 和 authKey。
 *
 * 两者由同一次 KDF（Argon2id 或 PBKDF2）输出经不同 info 的 HKDF 分叉而来：
 * 服务端拿到 authKey 也无法反推 KEK。
 *
 * v2.3.5：deriveKey 改为 async 以支持 PBKDF2（移动端原生 JSI），
 * 需在此处 await。
 */
export async function deriveSecrets(
  secret: string,
  salt: Uint8Array,
  params = KDF_PARAMS
): Promise<DerivedSecrets> {
  const ikm = await deriveKey(secret, salt, params);
  try {
    const [kek, authKey] = await Promise.all([
      hkdf(ikm, salt, KEK_INFO, 32),
      hkdf(ikm, salt, AUTH_INFO, 32),
    ]);
    return { kek, authKey };
  } finally {
    // ikm 是从主密码派生的高熵中间值，用后立即零化，降低堆泄漏风险
    zeroize(ikm);
  }
}

/** 随机生成 masterKey。只在 setup 时调用一次，此后终生不变。 */
export function generateMasterKey(): Uint8Array {
  return randomBytes(32);
}

// ========== AES-GCM-256 ==========

export interface Ciphertext {
  /** 算法版本 */
  v: number;
  /** 密钥版本（用于双版本解密迁移） */
  k: number;
  /** nonce（base64） */
  n: string;
  /** 密文（base64） */
  c: string;
  /**
   * AAD 标记：1 = 加密时绑定了 AAD，解密时必须传入同一份 AAD，否则认证失败。
   * 缺省（undefined / 0）= 历史密文，无 AAD 绑定（向后兼容）。
   *
   * 注意：AAD 本身不存放在密文里——它必须是调用方上下文已知的值
   *（如 noteId、shareToken），存这里反而让攻击者能伪造。
   */
  a?: number;
}

async function importAesKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', key as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * AES-GCM 加密。
 *
 * @param key 32 字节密钥
 * @param plaintext 明文
 * @param keyVersion 密钥版本，写入密文信封以便双版本迁移
 * @param aad 可选的「附加认证数据」。绑定后，解密时必须传入相同 AAD，
 *            否则 AES-GCM 认证失败——可防止把一条密文挪用到另一个上下文
 *            （如把 note A 的密文塞给 note B 的记录）。
 */
export async function encrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  keyVersion = 1,
  aad?: Uint8Array
): Promise<Ciphertext> {
  const ck = await importAesKey(key);
  const nonce = randomBytes(12);
  const params: AesGcmParams = { name: 'AES-GCM', iv: nonce as BufferSource };
  if (aad) (params as AesGcmParams & { additionalData: BufferSource }).additionalData = aad as BufferSource;
  const ct = await crypto.subtle.encrypt(params, ck, plaintext as BufferSource);
  return {
    v: 1,
    k: keyVersion,
    n: toBase64(nonce),
    c: toBase64(new Uint8Array(ct)),
    a: aad ? 1 : 0,
  };
}

export async function decrypt(
  key: Uint8Array,
  blob: Ciphertext,
  aad?: Uint8Array
): Promise<Uint8Array> {
  const ck = await importAesKey(key);
  const nonce = fromBase64(blob.n);
  const ct = fromBase64(blob.c);
  const params: AesGcmParams = { name: 'AES-GCM', iv: nonce as BufferSource };
  const blobHasAad = blob.a === 1;
  if (blobHasAad) {
    if (!aad) {
      throw new Error('decrypt: 此密文绑定了 AAD，但解密时未提供 AAD');
    }
    (params as AesGcmParams & { additionalData: BufferSource }).additionalData = aad as BufferSource;
  } else if (aad) {
    // 历史密文没有 AAD，但调用方传了 AAD：可能调用方搞错了上下文，拒绝解密
    throw new Error('decrypt: 此密文未绑定 AAD，但解密时传入了 AAD（上下文不匹配）');
  }
  const pt = await crypto.subtle.decrypt(params, ck, ct as BufferSource);
  return new Uint8Array(pt);
}

// ========== 高层便捷方法（字符串）==========

export async function encryptString(
  key: Uint8Array,
  plaintext: string,
  keyVersion = 1,
  aad?: Uint8Array
): Promise<Ciphertext> {
  return encrypt(key, encodeUtf8(plaintext), keyVersion, aad);
}

export async function decryptString(
  key: Uint8Array,
  blob: Ciphertext,
  aad?: Uint8Array
): Promise<string> {
  return decodeUtf8(await decrypt(key, blob, aad));
}

// ========== 密钥零化 ==========
//
// JavaScript 没有真正的「析构」，Uint8Array 在 GC 前会一直留在堆里。
// 对持有 masterKey / KEK / shareKey 的 buffer，使用后应主动覆写零，
// 降低「堆转储 / 内存复用」场景下的密钥泄漏面。
//
// 注意：派生密钥的输入（如 Argon2id 的输出 ikm）即便零化，也无法清除
// noble 内部可能缓存的副本——这是 JS 运行时的固有局限。这里的零化
// 是「尽力而为」的纵深防御，不是密码学保证。

/**
 * 用零覆写 Uint8Array。对不可写视图静默跳过。
 * 接受 undefined 也安全（便于在 finally 块里直接传。
 */
export function zeroize(buf: Uint8Array | null | undefined): void {
  if (!buf) return;
  try {
    buf.fill(0);
  } catch {
    /* 只读视图或 detached buffer，忽略 */
  }
}

// ========== 密钥包装 ==========

/** 用 KEK 包装 masterKey，产物存服务端 */
export async function wrapKey(kek: Uint8Array, key: Uint8Array): Promise<Ciphertext> {
  return encrypt(kek, key, 1);
}

/** 用 KEK 解封 masterKey；KEK 不对会抛错（AES-GCM 认证失败） */
export async function unwrapKey(kek: Uint8Array, wrapped: Ciphertext): Promise<Uint8Array> {
  return decrypt(kek, wrapped);
}

// ========== Recovery Code ==========
//
// v1 用的是 6 位纯数字（10^6 ≈ 2^20），配上比主密码更弱的 KDF 参数，
// 拿到数据库的人可以直接离线穷举出 masterKey——整套 E2EE 的最短板。
//
// v2 改为 10 位 Crockford Base32（32^10 ≈ 2^50），并与主密码共用同一套
// 强 KDF 参数。展示时按 XXXXX-XXXXX 分组，方便用户抄写。

/** Crockford Base32：去掉了容易混淆的 I / L / O / U */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_LENGTH = 10;

/**
 * 生成恢复码，形如 `A7K2M-9PQR3`。
 *
 * 256 能被 32 整除，所以按字节取模不引入偏置。
 */
export function generateRecoveryCode(): string {
  const bytes = nobleRandomBytes(RECOVERY_LENGTH);
  let code = '';
  for (let i = 0; i < RECOVERY_LENGTH; i++) {
    code += RECOVERY_ALPHABET[bytes[i]! % 32];
  }
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * 规范化用户输入的恢复码：去掉分隔符、转大写，并按 Crockford 约定
 * 把易混字符纠正回去（O→0，I/L→1）。
 *
 * 派生前必须调用，否则用户抄错一个字形就解不开。
 */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** 判断规范化后的恢复码是否形如合法的 v2 恢复码 */
export function isValidRecoveryCode(input: string): boolean {
  const normalized = normalizeRecoveryCode(input);
  if (normalized.length !== RECOVERY_LENGTH) return false;
  for (const ch of normalized) {
    if (!RECOVERY_ALPHABET.includes(ch)) return false;
  }
  return true;
}

// ========== 常量时间比较（防计时攻击）==========

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

// ========== 类型守卫 ==========

export function isCiphertext(x: unknown): x is Ciphertext {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as Ciphertext).v === 'number' &&
    typeof (x as Ciphertext).k === 'number' &&
    typeof (x as Ciphertext).n === 'string' &&
    typeof (x as Ciphertext).c === 'string'
  );
}
