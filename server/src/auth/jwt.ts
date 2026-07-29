/**
 * 标准 JWT 工具（支持 EdDSA / Ed25519 与 HS256 双算法）
 *
 * 签名算法选择（启动时一次性决定，不随请求变化）：
 *   1. 配置了 JWT_PRIVATE_KEY + JWT_PUBLIC_KEY → EdDSA（Ed25519，非对称）
 *      优势：私钥只在服务端，即使密钥泄露也无法签发新 token；
 *            公钥可分发给客户端 / 网关做离线验签。
 *   2. 否则回退到 JWT_SECRET → HS256（HMAC-SHA256，对称）
 *      保持向后兼容，迁移期间旧 token 仍可验签。
 *
 * 单用户无注册系统：access token 短期（15min），refresh token 长期（30d）
 *
 * 安全说明：
 * - EdDSA 使用 Node.js crypto.sign/verify（原生 Ed25519，无第三方依赖）
 * - HS256 使用 timingSafeEqual 恒定时间比较，防时序攻击
 * - verifyToken 同时支持两种算法（按 header.alg 分发），平滑迁移
 */

import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  sign as cryptoSign,
  verify as cryptoVerify,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from 'node:crypto';
import { config } from '../env.js';

const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_S = 30 * 24 * 60 * 60;

// ========== 算法选择 ==========

type JwtAlgorithm = 'EdDSA' | 'HS256';

function resolveAlgorithm(): {
  alg: JwtAlgorithm;
  privateKey?: KeyObject;
  publicKey?: KeyObject;
} {
  // 优先 EdDSA：需要同时配置私钥和公钥
  if (config.jwtPrivateKey && config.jwtPublicKey) {
    try {
      const privateKey = createPrivateKey(config.jwtPrivateKey);
      const publicKey = createPublicKey(config.jwtPublicKey);
      return { alg: 'EdDSA', privateKey, publicKey };
    } catch (err) {
      console.error('[jwt] JWT_PRIVATE_KEY/JWT_PUBLIC_KEY 解析失败，回退到 HS256:', (err as Error).message);
    }
  }
  return { alg: 'HS256' };
}

const resolved = resolveAlgorithm();
const ACTIVE_ALG = resolved.alg;
const ED25519_PRIVATE_KEY = resolved.privateKey;
const ED25519_PUBLIC_KEY = resolved.publicKey;

const JWT_HEADER_EDDSA = JSON.stringify({ alg: 'EdDSA', typ: 'JWT' });
const JWT_HEADER_HS256 = JSON.stringify({ alg: 'HS256', typ: 'JWT' });

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

// ========== 签名 ==========

/** EdDSA 签名（Ed25519）—— Node.js crypto.sign(null, ...) 即 Ed25519 */
function signEdDSA(input: string): string {
  // cryptoSign 的算法参数对 Ed25519 必须为 null（由 key 推断）
  const sig = cryptoSign(null, Buffer.from(input), ED25519_PRIVATE_KEY!);
  return sig.toString('base64url');
}

/** HS256 签名（HMAC-SHA256） */
function signHS256(input: string): string {
  return createHmac('sha256', config.jwtSecret).update(input).digest('base64url');
}

/** 按当前激活算法签名 */
function sign(input: string): string {
  return ACTIVE_ALG === 'EdDSA' ? signEdDSA(input) : signHS256(input);
}

export interface JwtPayload {
  sub: string; // userId
  device: string; // deviceId
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
  jti: string;
}

function issueToken(
  userId: string,
  deviceId: string,
  type: 'access' | 'refresh',
  ttl: number
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: userId,
    device: deviceId,
    type,
    iat: now,
    exp: now + ttl,
    jti: randomBytes(16).toString('hex'),
  };
  const header = b64url(ACTIVE_ALG === 'EdDSA' ? JWT_HEADER_EDDSA : JWT_HEADER_HS256);
  const body = b64url(JSON.stringify(payload));
  const signature = sign(`${header}.${body}`);
  return `${header}.${body}.${signature}`;
}

export function issueAccessToken(userId: string, deviceId: string): string {
  return issueToken(userId, deviceId, 'access', ACCESS_TTL_S);
}

export function issueRefreshToken(userId: string, deviceId: string): string {
  return issueToken(userId, deviceId, 'refresh', REFRESH_TTL_S);
}

// ========== 验签 ==========

/** 验证 EdDSA 签名 */
function verifyEdDSA(input: string, signatureB64: string): boolean {
  try {
    const sigBuf = Buffer.from(signatureB64, 'base64url');
    return cryptoVerify(null, Buffer.from(input), ED25519_PUBLIC_KEY!, sigBuf);
  } catch {
    return false;
  }
}

/** 验证 HS256 签名（恒定时间比较） */
function verifyHS256(input: string, signatureB64: string): boolean {
  const expected = signHS256(input);
  const sigBuf = Buffer.from(signatureB64);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return timingSafeEqual(sigBuf, expBuf);
}

export function verifyToken(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];

  // 验证 header 并按 alg 分发
  let alg: JwtAlgorithm | null = null;
  try {
    const decodedHeader = JSON.parse(fromB64url(header).toString()) as {
      alg?: string;
      typ?: string;
    };
    if (decodedHeader.typ !== 'JWT') return null;
    if (decodedHeader.alg === 'EdDSA') alg = 'EdDSA';
    else if (decodedHeader.alg === 'HS256') alg = 'HS256';
    else return null;
  } catch {
    return null;
  }

  const input = `${header}.${body}`;
  // 拒绝 alg=none 及算法降级攻击：只接受配置支持的算法
  let sigValid: boolean;
  if (alg === 'EdDSA') {
    // 仅当服务端配置了 EdDSA 公钥时才接受 EdDSA token
    if (!ED25519_PUBLIC_KEY) return null;
    sigValid = verifyEdDSA(input, signature);
  } else {
    // HS256
    sigValid = verifyHS256(input, signature);
  }
  if (!sigValid) return null;

  try {
    const payload = JSON.parse(fromB64url(body).toString()) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.type !== 'access' && payload.type !== 'refresh') return null;
    return payload;
  } catch {
    return null;
  }
}

export const ACCESS_TTL = ACCESS_TTL_S;
export const REFRESH_TTL = REFRESH_TTL_S;

/** 当前激活的签名算法（供启动日志 / 健康检查使用） */
export const ACTIVE_ALGORITHM: JwtAlgorithm = ACTIVE_ALG;
