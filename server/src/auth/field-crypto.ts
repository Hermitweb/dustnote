/**
 * 字段级加密（审计 SEC-R08）：对 users.totp_secret 等敏感列做 AES-256-GCM 加密。
 *
 * 威胁模型：DB 文件 / 备份泄露（攻击者拿到 .db 但没有 .env）。KEK 来自
 * FIELD_ENCRYPTION_KEY；未配置时回退用 JWT_SECRET 经 HKDF 派生（独立 info，
 * 与 JWT 签名密钥不共用同一字节），保证既有自托管部署无需新增 env 即可平滑启用。
 *
 * 密文格式（自描述，便于向后兼容与轮换）：`enc:v1:<iv_b64url>:<tag_b64url>:<ct_b64url>`。
 * decryptField 对不以 `enc:v1:` 开头的历史明文原样返回（迁移前/未启用时兼容）。
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../env.js';

const PREFIX = 'enc:v1:';
let cachedKey: Buffer | null = null;

function fieldKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret =
    process.env.FIELD_ENCRYPTION_KEY && process.env.FIELD_ENCRYPTION_KEY.trim()
      ? process.env.FIELD_ENCRYPTION_KEY.trim()
      : config.jwtSecret;
  // HKDF-SHA256 派生 32B 密钥，info 与 JWT 用途隔离
  const okm = hkdfSync(
    'sha256',
    Buffer.from(secret, 'utf8'),
    Buffer.from('dustnote:field:v1'),
    Buffer.from('totp_secret'),
    32
  );
  cachedKey = Buffer.from(okm);
  return cachedKey;
}

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', fieldKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`;
}

/** 解密；非本格式（历史明文）原样返回，保证向后兼容。 */
export function decryptField(stored: string): string {
  if (!stored || !stored.startsWith(PREFIX)) return stored;
  const parts = stored.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return stored;
  const [ivB, tagB, ctB] = parts as [string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', fieldKey(), Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]);
  return pt.toString('utf8');
}

export function isEncryptedField(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(PREFIX);
}
