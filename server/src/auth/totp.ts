/**
 * TOTP (Time-based One-Time Password) 服务
 *
 * RFC 6238 实现，使用 Node.js crypto 模块，无需外部依赖。
 * 兼容 Google Authenticator / Authy / 1Password 等所有 TOTP 应用。
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const DIGITS = 6;
const PERIOD = 30; // 秒
const ALGORITHM = 'sha1';

/**
 * 生成 TOTP 密钥（base32 编码，20 字节 → 32 字符）
 */
export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  return base32Encode(bytes);
}

/**
 * 生成 TOTP URI（用于 QR 码生成）
 *
 * 格式：otpauth://totp/DustNote:user@example.com?secret=XXX&issuer=DustNote&digits=6&period=30
 */
export function generateTotpUri(secret: string, accountName: string): string {
  const encodedIssuer = encodeURIComponent('DustNote');
  const encodedAccount = encodeURIComponent(accountName);
  return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&digits=${DIGITS}&period=${PERIOD}`;
}

/**
 * 生成当前 TOTP 验证码
 */
export function generateTotp(secret: string, time?: number): string {
  const counter = Math.floor((time ?? Date.now() / 1000) / PERIOD);
  return computeHotp(base32Decode(secret), counter);
}

/**
 * 验证 TOTP 验证码（允许前后 1 个时间窗口的偏移，共 3 个窗口）
 *
 * @param token 用户输入的 6 位验证码
 * @param secret base32 编码的密钥
 * @returns 验证是否通过
 */
export function verifyTotp(token: string, secret: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  // 检查当前窗口和前后各 1 个窗口（允许 ±30 秒的时钟偏移）
  for (const offset of [0, -1, 1]) {
    const counter = Math.floor((now + offset * PERIOD) / PERIOD);
    const expected = computeHotp(base32Decode(secret), counter);
    if (timingSafeEqualCompare(token, expected)) {
      return true;
    }
  }
  return false;
}

// ========== HOTP (RFC 4226) ==========

function computeHotp(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);

  const hmac = createHmac(ALGORITHM, key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  const otp = binary % 10 ** DIGITS;
  return otp.toString().padStart(DIGITS, '0');
}

function timingSafeEqualCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ========== Base32 (RFC 4648) ==========

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer: Buffer): string {
  let bits = '';
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, '0');
  }
  let result = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    result += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return result;
}

function base32Decode(str: string): Buffer {
  const cleaned = str.replace(/[^A-Za-z2-7]/g, '').toUpperCase();
  let bits = '';
  for (const char of cleaned) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}
