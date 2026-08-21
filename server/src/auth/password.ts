/**
 * 分享密码哈希（scrypt + 随机 salt）
 * 使用 Node.js 内置 crypto，无需额外原生依赖
 *
 * security.md §1.1：哈希算法要求 Argon2id；scrypt 是 Node 内置的等效内存硬 KDF，
 * 这里按 OWASP 推荐强度显式设置参数（N=2^17, r=8, p=1，约 128MB 内存），
 * 并通过版本前缀兼容旧哈希（旧默认参数 N=2^14 仍可验证，rehash 后升级）。
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SALT_LEN = 16;
const KEY_LEN = 32;

/** 新版参数（OWASP 推荐：≥128MB 内存，单次约 0.5-1s） */
const NEW_N = 1 << 17; // 131072
const NEW_R = 8;
const NEW_P = 1;

/** 旧版默认参数（Node scrypt 默认 N=16384），仅用于验证历史哈希 */
const LEGACY_N = 1 << 14;

const PREFIX = 'scrypt$';

/** 导出当前参数，便于测试与未来迁移 */
export const SCRYPT_PARAMS = { N: NEW_N, r: NEW_R, p: NEW_P };

function derive(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  // maxmem 必须 ≥ 128 * r * N（128MB @ N=2^17, r=8），否则 Node 报 memory limit exceeded
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, { N, r, p, maxmem: 256 * 1024 * 1024 }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * 对明文密码进行哈希，返回 versioned 格式：
 *   scrypt$N$r$p$<salt-base64url>$<hash-base64url>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const derived = await derive(password, salt, NEW_N, NEW_R, NEW_P);
  return `${PREFIX}${NEW_N}$${NEW_R}$${NEW_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

/**
 * 验证明文密码与存储的哈希。
 * 兼容旧格式（salt+hash 直接拼接，默认参数）与新版带前缀格式。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    if (stored.startsWith(PREFIX)) {
      const parts = stored.split('$');
      if (parts.length !== 6) return false;
      const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
      if (
        nStr === undefined ||
        rStr === undefined ||
        pStr === undefined ||
        saltB64 === undefined ||
        hashB64 === undefined
      ) {
        return false;
      }
      const N = Number(nStr);
      const r = Number(rStr);
      const p = Number(pStr);
      if (
        !Number.isInteger(N) ||
        !Number.isInteger(r) ||
        !Number.isInteger(p) ||
        N < 2 ||
        r < 1 ||
        p < 1
      ) {
        return false;
      }
      const salt = Buffer.from(saltB64, 'base64url');
      const hash = Buffer.from(hashB64, 'base64url');
      if (salt.length !== SALT_LEN || hash.length !== KEY_LEN) return false;
      const derived = await derive(password, salt, N, r, p);
      return timingSafeEqual(hash, derived);
    }

    // 旧格式：无前缀，salt(16B) + hash(32B)，默认参数
    const combined = Buffer.from(stored, 'base64url');
    if (combined.length !== SALT_LEN + KEY_LEN) return false;

    const salt = combined.subarray(0, SALT_LEN);
    const hash = combined.subarray(SALT_LEN);
    const derived = await derive(password, salt, LEGACY_N, 8, 1);

    if (hash.length !== derived.length) return false;
    return timingSafeEqual(hash, derived);
  } catch {
    return false;
  }
}
