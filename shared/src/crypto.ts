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

export function randomBytes(n: number): Uint8Array {
  return nobleRandomBytes(n);
}

// ========== KDF（Argon2id）==========
//
// 服务端和客户端**必须**使用相同参数。

export interface KdfParams {
  m: number;
  t: number;
  p: number;
  dkLen: number;
}

export const KDF_PARAMS: KdfParams = {
  m: 64 * 1024, // 64 MB
  t: 3,
  p: 4,
  dkLen: 32,
};

export function deriveKey(password: string, salt: Uint8Array, params = KDF_PARAMS): Uint8Array {
  return nobleArgon2id(password, salt, {
    m: params.m,
    t: params.t,
    p: params.p,
    dkLen: params.dkLen,
  }) as Uint8Array;
}

// ========== HKDF-SHA256 ==========

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const ck = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', ck, data as BufferSource);
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

// ========== 主密钥派生 ==========

export const KDF_VERSION = 1;
export const KDF_INFO = `mn-master-v${KDF_VERSION}`;

/** 主密码 → masterKey */
export async function deriveMasterKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const ikm = deriveKey(password, salt);
  return hkdf(ikm, salt, KDF_INFO, 32);
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
}

async function importAesKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', key as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  keyVersion = 1
): Promise<Ciphertext> {
  const ck = await importAesKey(key);
  const nonce = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    ck,
    plaintext as BufferSource
  );
  return {
    v: 1,
    k: keyVersion,
    n: toBase64(nonce),
    c: toBase64(new Uint8Array(ct)),
  };
}

export async function decrypt(key: Uint8Array, blob: Ciphertext): Promise<Uint8Array> {
  const ck = await importAesKey(key);
  const nonce = fromBase64(blob.n);
  const ct = fromBase64(blob.c);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    ck,
    ct as BufferSource
  );
  return new Uint8Array(pt);
}

// ========== 高层便捷方法（字符串）==========

export async function encryptString(
  key: Uint8Array,
  plaintext: string,
  keyVersion = 1
): Promise<Ciphertext> {
  return encrypt(key, encodeUtf8(plaintext), keyVersion);
}

export async function decryptString(key: Uint8Array, blob: Ciphertext): Promise<string> {
  return decodeUtf8(await decrypt(key, blob));
}

// ========== Recovery Code（6 位数字）==========
//
// 设计：用户在 setup 时拿到一个 6 位 recovery code
// 它派生一个独立的 recoveryKey，可以解封 wrappedMasterKey
// 服务端不存 code 明文，只存 hash

export function generateRecoveryCode(): string {
  // 使用无符号 32 位整数（避免负数），然后取模
  const n = nobleRandomBytes(4);
  const num =
    (n[0]! & 0xff) * 0x1000000 + (n[1]! & 0xff) * 0x10000 + (n[2]! & 0xff) * 0x100 + (n[3]! & 0xff);
  const code = (num % 1000000).toString().padStart(6, '0');
  return code;
}

export function deriveRecoveryKey(code: string, salt: Uint8Array): Uint8Array {
  return deriveKey(code, salt, { m: 16 * 1024, t: 2, p: 2, dkLen: 32 });
}

/** 用 recoveryKey 包装 masterKey；服务端存 wrappedMasterKey */
export async function wrapMasterKey(
  recoveryKey: Uint8Array,
  masterKey: Uint8Array
): Promise<Ciphertext> {
  return encrypt(recoveryKey, masterKey, 1);
}

/** 用 recoveryKey 解封 masterKey */
export async function unwrapMasterKey(
  recoveryKey: Uint8Array,
  wrapped: Ciphertext
): Promise<Uint8Array> {
  return decrypt(recoveryKey, wrapped);
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
