/**
 * 标准 JWT 工具（HMAC-SHA256）
 * 单用户无注册系统：access token 短期（15min），refresh token 长期（30d）
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../env.js';

const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_S = 30 * 24 * 60 * 60;

const JWT_HEADER = JSON.stringify({ alg: 'HS256', typ: 'JWT' });

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

function sign(input: string): string {
  return createHmac('sha256', config.jwtSecret).update(input).digest('base64url');
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
  const header = b64url(JWT_HEADER);
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

export function verifyToken(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];

  // 验证 header
  try {
    const decodedHeader = JSON.parse(fromB64url(header).toString()) as {
      alg?: string;
      typ?: string;
    };
    if (decodedHeader.alg !== 'HS256' || decodedHeader.typ !== 'JWT') return null;
  } catch {
    return null;
  }

  // 恒定时间比较签名，防时序攻击
  const expected = sign(`${header}.${body}`);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;

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
