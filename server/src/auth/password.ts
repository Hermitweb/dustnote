/**
 * 分享密码哈希（scrypt + 随机 salt）
 * 使用 Node.js 内置 crypto，无需额外原生依赖
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const SALT_LEN = 16;
const KEY_LEN = 32;

/**
 * 对明文密码进行哈希，返回 base64url(salt + hash)
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  const combined = Buffer.concat([salt, derived]);
  return combined.toString('base64url');
}

/**
 * 验证明文密码与存储的哈希
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const combined = Buffer.from(stored, 'base64url');
    if (combined.length !== SALT_LEN + KEY_LEN) return false;

    const salt = combined.subarray(0, SALT_LEN);
    const hash = combined.subarray(SALT_LEN);
    const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;

    if (hash.length !== derived.length) return false;
    return timingSafeEqual(hash, derived);
  } catch {
    return false;
  }
}
