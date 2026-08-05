/**
 * IP 地址哈希（security.md §3.1 PII 处理）
 *
 * 审计日志不落明文 IP：入库前 SHA-256 加盐哈希，盐值 24h 轮换。
 * 哈希只用于反滥用关联（同一 IP 的登录失败 / 锁定模式），不可反解出原 IP。
 * 轮换后旧哈希无法与新哈希关联——按规范接受，避免跨天追踪用户。
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';

let salt = randomBytes(16);
let rotatedAt = Date.now();
const SALT_ROTATION_MS = 24 * 60 * 60 * 1000;

export function ipHash(req: Request): string {
  const now = Date.now();
  if (now - rotatedAt > SALT_ROTATION_MS) {
    salt = randomBytes(16);
    rotatedAt = now;
  }
  // trust proxy 已配置，req.ip 取 X-Forwarded-For 的真实客户端地址
  const ip = req.ip ?? req.socket?.remoteAddress ?? '';
  return createHash('sha256').update(salt).update(ip).digest('hex');
}
