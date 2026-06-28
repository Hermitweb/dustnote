/**
 * JWT 工具（HMAC-SHA256）
 * 单用户无注册系统：access token 短期（15min），refresh token 长期（30d）
 */

import { createHmac, randomBytes } from 'node:crypto';
import { config } from '../env.js';

const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_S = 30 * 24 * 60 * 60;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

function sign(payload: string): string {
  return createHmac('sha256', config.jwtSecret).update(payload).digest('base64url');
}

export interface JwtPayload {
  sub: string;     // userId
  device: string;  // deviceId
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
  jti: string;
}

export function issueAccessToken(userId: string, deviceId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: userId,
    device: deviceId,
    type: 'access',
    iat: now,
    exp: now + ACCESS_TTL_S,
    jti: randomBytes(16).toString('hex'),
  };
  return b64url(JSON.stringify(payload)) + '.' + sign(b64url(JSON.stringify(payload)));
}

export function issueRefreshToken(userId: string, deviceId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: userId,
    device: deviceId,
    type: 'refresh',
    iat: now,
    exp: now + REFRESH_TTL_S,
    jti: randomBytes(16).toString('hex'),
  };
  return b64url(JSON.stringify(payload)) + '.' + sign(b64url(JSON.stringify(payload)));
}

export function verifyToken(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [p, s] = parts as [string, string];
  if (sign(p) !== s) return null;
  try {
    const payload = JSON.parse(fromB64url(p).toString()) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export const ACCESS_TTL = ACCESS_TTL_S;
export const REFRESH_TTL = REFRESH_TTL_S;
