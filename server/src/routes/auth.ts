/**
 * 认证 API
 *
 * GET  /api/v1/auth/status          - 检查系统是否已初始化、当前设备是否激活
 * POST /api/v1/auth/setup           - 首次设置主密码 + 恢复码
 * POST /api/v1/auth/unlock          - 用主密码登录
 * POST /api/v1/auth/recover         - 用恢复码登录
 * POST /api/v1/auth/refresh         - 刷新 access token
 * POST /api/v1/auth/lock            - 锁屏（前端清空 masterKey）
 * GET  /api/v1/auth/me              - 当前用户信息
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomBytes, randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { config } from '../env.js';
import {
  deriveKey,
  deriveRecoveryKey,
  KDF_PARAMS,
  constantTimeEqual,
  type Ciphertext,
} from '@dustnote/shared';
import { issueAccessToken, issueRefreshToken, verifyToken, REFRESH_TTL } from '../auth/jwt.js';
import type { AuthUser } from '../middleware/auth.js';

export const authRouter = Router();

// ========== helpers ==========

function getRequestClient(req: Request): { version: string; platform: string; channel: string; deviceId: string } {
  return {
    version: req.header('X-Client-Version') ?? '',
    platform: req.header('X-Client-Platform') ?? '',
    channel: req.header('X-Client-Channel') ?? 'stable',
    deviceId: req.header('X-Client-Device-Id') ?? '',
  };
}

function writeRefreshCookie(res: Response, token: string): void {
  res.cookie('mn_refresh', token, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'strict',
    maxAge: REFRESH_TTL * 1000,
    path: '/api/v1/auth',
  });
}

// ========== GET /auth/status ==========

authRouter.get('/auth/status', (req, res) => {
  const db = getDb();
  const userCount = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  const client = getRequestClient(req);
  let deviceKnown = false;
  if (client.deviceId && userCount > 0) {
    deviceKnown = !!db.prepare('SELECT 1 FROM devices WHERE id = ?').get(client.deviceId);
  }
  res.json({
    initialized: userCount > 0,
    deviceKnown,
  });
});

// ========== POST /auth/setup ==========

const SetupSchema = z.object({
  password: z.string().min(8).max(256),
  recoveryCode: z.string().regex(/^\d{6}$/),
  /** 客户端用 recoveryKey 加密 masterKey 的密文 */
  wrappedMasterKey: z.object({
    v: z.number(),
    k: z.number(),
    n: z.string(),
    c: z.string(),
  }),
  /** 客户端的 masterSalt（用于客户端派生 masterKey） */
  clientMasterSalt: z.string().min(1).max(128),
  deviceName: z.string().min(1).max(64).default('新设备'),
});

authRouter.post('/auth/setup', (req, res) => {
  const parsed = SetupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
    return;
  }
  const { password, recoveryCode, wrappedMasterKey, clientMasterSalt, deviceName } = parsed.data;
  const client = getRequestClient(req);

  if (!client.deviceId) {
    res.status(400).json({ error: 'missing_device_id' });
    return;
  }

  const db = getDb();
  const userCount = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  if (userCount > 0) {
    res.status(409).json({ error: 'already_initialized', message: '系统已初始化，请用 unlock 登录' });
    return;
  }

  // 派生 key（服务端 masterSalt 用于 passwordHash 校验；客户端 masterSalt 由客户端管理）
  const serverMasterSalt = randomBytes(16);
  const recoverySalt = randomBytes(16);
  const passwordHash = deriveKey(password, serverMasterSalt);
  const recoveryHash = deriveRecoveryKey(recoveryCode, recoverySalt);

  // 创建设备 ID
  const userId = randomUUID();
  const deviceId = client.deviceId;

  const txn = db.transaction(() => {
    db.prepare(`
      INSERT INTO users (id, password_hash, recovery_hash, master_salt, recovery_salt, wrapped_master_key, kdf_version, kdf_params, recovery_code_set, client_master_salt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      userId,
      Buffer.from(passwordHash),
      Buffer.from(recoveryHash),
      Buffer.from(serverMasterSalt),
      Buffer.from(recoverySalt),
      JSON.stringify(wrappedMasterKey),
      1,
      JSON.stringify({ m: KDF_PARAMS.m, t: KDF_PARAMS.t, p: KDF_PARAMS.p, dkLen: KDF_PARAMS.dkLen }),
      clientMasterSalt
    );

    db.prepare(`
      INSERT INTO devices (id, user_id, name, platform, fingerprint)
      VALUES (?, ?, ?, ?, ?)
    `).run(deviceId, userId, deviceName, client.platform || 'web', client.deviceId);

    db.prepare(`
      INSERT INTO preferences (user_id) VALUES (?)
    `).run(userId);
  });
  txn();

  const access = issueAccessToken(userId, deviceId);
  const refresh = issueRefreshToken(userId, deviceId);
  writeRefreshCookie(res, refresh);

  logger.info({ userId, deviceId, platform: client.platform }, '新用户已创建');
  res.json({
    accessToken: access,
    userId,
    deviceId,
    /** 返回客户端的 masterSalt（base64），用于客户端派生 masterKey */
    clientMasterSalt,
  });
});

// ========== POST /auth/unlock ==========

const UnlockSchema = z.object({
  password: z.string().min(1).max(256),
  deviceName: z.string().min(1).max(64).optional(),
});

authRouter.post('/auth/unlock', (req, res) => {
  const parsed = UnlockSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const { password, deviceName } = parsed.data;
  const client = getRequestClient(req);

  if (!client.deviceId) {
    res.status(400).json({ error: 'missing_device_id' });
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT id, password_hash, master_salt, kdf_params, kdf_version, client_master_salt FROM users LIMIT 1').get() as
    | { id: string; password_hash: Buffer; master_salt: Buffer; kdf_params: string; kdf_version: number; client_master_salt: string | null }
    | undefined;

  if (!user) {
    res.status(404).json({ error: 'not_initialized', message: '系统未初始化，请先 setup' });
    return;
  }

  // 用相同参数派生
  let params = { m: KDF_PARAMS.m, t: KDF_PARAMS.t, p: KDF_PARAMS.p, dkLen: KDF_PARAMS.dkLen };
  if (user.kdf_params) {
    try {
      const parsed2 = JSON.parse(user.kdf_params) as typeof params;
      params = parsed2;
    } catch {
      /* 使用默认 */
    }
  }
  const candidate = deriveKey(password, new Uint8Array(user.master_salt), params);

  // 常量时间比较
  const stored = new Uint8Array(user.password_hash);
  if (candidate.length !== stored.length || !constantTimeEqual(candidate, stored)) {
    logger.warn({ userId: user.id, deviceId: client.deviceId }, '密码错误');
    res.status(401).json({ error: 'invalid_password', message: '密码错误' });
    return;
  }

  // 注册/更新设备
  const existing = db.prepare('SELECT 1 FROM devices WHERE id = ? AND user_id = ?').get(client.deviceId, user.id);
  if (!existing) {
    db.prepare(`
      INSERT INTO devices (id, user_id, name, platform, fingerprint, last_active_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(
      client.deviceId,
      user.id,
      deviceName ?? '新设备',
      client.platform || 'web',
      client.deviceId
    );
  } else {
    db.prepare(`UPDATE devices SET last_active_at = datetime('now') WHERE id = ?`).run(client.deviceId);
  }

  const access = issueAccessToken(user.id, client.deviceId);
  const refresh = issueRefreshToken(user.id, client.deviceId);
  writeRefreshCookie(res, refresh);

  logger.info({ userId: user.id, deviceId: client.deviceId }, '用户解锁');
  res.json({
    accessToken: access,
    userId: user.id,
    deviceId: client.deviceId,
    /** 返回客户端的 masterSalt，客户端用其派生 masterKey */
    clientMasterSalt: user.client_master_salt,
  });
});

// ========== POST /auth/recover ==========

const RecoverSchema = z.object({
  recoveryCode: z.string().regex(/^\d{6}$/),
  newPassword: z.string().min(8).max(256),
  newWrappedMasterKey: z.object({
    v: z.number(),
    k: z.number(),
    n: z.string(),
    c: z.string(),
  }),
  newClientMasterSalt: z.string().min(1).max(128),
  deviceName: z.string().min(1).max(64).optional(),
});

authRouter.post('/auth/recover', (req, res) => {
  const parsed = RecoverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const { recoveryCode, newPassword, newWrappedMasterKey, newClientMasterSalt, deviceName } = parsed.data;
  const client = getRequestClient(req);

  if (!client.deviceId) {
    res.status(400).json({ error: 'missing_device_id' });
    return;
  }

  const db = getDb();
  const user = db.prepare(`
    SELECT id, recovery_hash, recovery_salt, kdf_params
    FROM users LIMIT 1
  `).get() as
    | { id: string; recovery_hash: Buffer; recovery_salt: Buffer; kdf_params: string }
    | undefined;

  if (!user) {
    res.status(404).json({ error: 'not_initialized' });
    return;
  }

  // 校验 recovery code
  const recoveryKey = deriveRecoveryKey(recoveryCode, new Uint8Array(user.recovery_salt));
  const stored = new Uint8Array(user.recovery_hash);
  if (!constantTimeEqual(recoveryKey, stored)) {
    logger.warn({ userId: user.id }, '恢复码错误');
    res.status(401).json({ error: 'invalid_recovery_code' });
    return;
  }

  // 重置密码：重新派生 masterSalt / passwordHash
  const newMasterSalt = randomBytes(16);
  const newPasswordHash = deriveKey(newPassword, newMasterSalt, KDF_PARAMS);

  db.prepare(`
    UPDATE users
    SET password_hash = ?, master_salt = ?, wrapped_master_key = ?, kdf_params = ?, kdf_version = 1, client_master_salt = ?
    WHERE id = ?
  `).run(
    Buffer.from(newPasswordHash),
    Buffer.from(newMasterSalt),
    JSON.stringify(newWrappedMasterKey),
    JSON.stringify({ m: KDF_PARAMS.m, t: KDF_PARAMS.t, p: KDF_PARAMS.p, dkLen: KDF_PARAMS.dkLen }),
    newClientMasterSalt,
    user.id
  );

  // 注册设备
  if (!db.prepare('SELECT 1 FROM devices WHERE id = ? AND user_id = ?').get(client.deviceId, user.id)) {
    db.prepare(`
      INSERT INTO devices (id, user_id, name, platform, fingerprint, last_active_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(client.deviceId, user.id, deviceName ?? '新设备', client.platform || 'web', client.deviceId);
  }

  const access = issueAccessToken(user.id, client.deviceId);
  const refresh = issueRefreshToken(user.id, client.deviceId);
  writeRefreshCookie(res, refresh);

  logger.info({ userId: user.id, deviceId: client.deviceId }, '用户通过恢复码重置密码');
  res.json({
    accessToken: access,
    userId: user.id,
    deviceId: client.deviceId,
    clientMasterSalt: newClientMasterSalt,
  });
});

// ========== POST /auth/refresh ==========

authRouter.post('/auth/refresh', (req, res) => {
  const refresh = req.cookies?.mn_refresh as string | undefined;
  if (!refresh) {
    res.status(401).json({ error: 'no_refresh_token' });
    return;
  }
  const payload = verifyToken(refresh);
  if (!payload || payload.type !== 'refresh') {
    res.status(401).json({ error: 'invalid_refresh_token' });
    return;
  }

  const access = issueAccessToken(payload.sub, payload.device);
  res.json({ accessToken: access });
});

// ========== POST /auth/lock ==========

authRouter.post('/auth/lock', (req, res) => {
  // 锁屏是纯客户端行为：清空内存中的 masterKey
  // 服务端只记录一条 audit log
  const user = req.user as AuthUser | undefined;
  if (user) {
    getDb()
      .prepare('INSERT INTO audit_log (user_id, device_id, event) VALUES (?, ?, ?)')
      .run(user.userId, user.deviceId, 'lock');
  }
  res.json({ ok: true });
});

// ========== GET /auth/me ==========

authRouter.get('/auth/me', (req, res) => {
  const user = req.user as AuthUser | undefined;
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const db = getDb();
  const u = db.prepare(`
    SELECT id, created_at, wrapped_master_key
    FROM users WHERE id = ?
  `).get(user.userId) as { id: string; created_at: string; wrapped_master_key: string } | undefined;
  if (!u) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  res.json({
    userId: u.id,
    createdAt: u.created_at,
    wrappedMasterKey: JSON.parse(u.wrapped_master_key) as Ciphertext,
  });
});
