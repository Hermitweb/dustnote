/**
 * 认证 API（协议 v2 + 账号锁定）
 *
 * GET  /api/v1/auth/status          - 是否已初始化 + 派生 KEK 所需的 pw_salt
 * POST /api/v1/auth/setup           - 首次设置：上传两份包装好的 masterKey
 * POST /api/v1/auth/unlock          - 用 authKey 登录，取回 pw 包装的 masterKey
 * GET  /api/v1/auth/recovery-params - 恢复码派生所需的 rc_salt
 * POST /api/v1/auth/recover         - 用恢复码登录，取回 rc 包装的 masterKey
 * POST /api/v1/auth/rewrap          - 换密码/换恢复码：重新上传包装结果
 * POST /api/v1/auth/refresh         - 刷新 access token
 * POST /api/v1/auth/lock            - 锁屏（前端清空 masterKey）
 * GET  /api/v1/auth/me              - 当前用户信息
 *
 * 服务端在整个流程里**看不到主密码，也看不到 masterKey**：
 * 客户端只上传 authKey（用于身份校验）和密文形式的 wrappedMasterKey。
 *
 * 账号锁定：连续 6 次 authKey 错误 → 锁定 15 分钟（与 IP 限流互补）。
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { config } from '../env.js';
import { KDF_PARAMS, type Ciphertext } from '@dustnote/shared';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  issueAccessToken,
  issueRefreshToken,
  verifyToken,
  hashRefreshToken,
  safeEqualHash,
  REFRESH_TTL,
} from '../auth/jwt.js';
import {
  isLocked,
  recordFailure,
  recordSuccess,
  remainingLockMs,
  MAX_FAILED_ATTEMPTS,
  type LockoutState,
} from '../auth/lockout.js';
import type { AuthUser } from '../middleware/auth.js';

export const authRouter = Router();

// ========== 校验片段 ==========

/** authKey：客户端 HKDF 出来的 32 字节，base64 后 44 字符 */
const AuthKeySchema = z.string().min(43).max(64);
/** 盐：16 字节 base64 */
const SaltSchema = z.string().min(16).max(64);
/** 包装后的 masterKey 密文信封 */
const CiphertextSchema = z.object({
  v: z.number(),
  k: z.number(),
  n: z.string().min(1).max(64),
  c: z.string().min(1).max(512),
});

// ========== helpers ==========

function getRequestClient(req: Request): {
  version: string;
  platform: string;
  channel: string;
  deviceId: string;
} {
  return {
    version: req.header('X-Client-Version') ?? '',
    platform: req.header('X-Client-Platform') ?? '',
    channel: req.header('X-Client-Channel') ?? 'stable',
    deviceId: req.header('X-Client-Device-Id') ?? '',
  };
}

function writeRefreshCookie(res: Response, token: string): void {
  res.cookie('dustnote_refresh', token, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'strict',
    maxAge: REFRESH_TTL * 1000,
    path: '/api/v1/auth',
  });
}

interface UserRow {
  id: string;
  pw_salt: Buffer;
  rc_salt: Buffer;
  auth_hash: string;
  recovery_auth_hash: string;
  wrapped_master_key_pw: string;
  wrapped_master_key_rc: string;
  failed_attempts: number;
  locked_until: string | null;
}

function loadUser(): UserRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, pw_salt, rc_salt, auth_hash, recovery_auth_hash,
              wrapped_master_key_pw, wrapped_master_key_rc,
              failed_attempts, locked_until
       FROM users WHERE auth_hash IS NOT NULL LIMIT 1`
    )
    .get() as UserRow | undefined;
}

/** 注册设备或刷新其活跃时间 */
function touchDevice(userId: string, deviceId: string, platform: string, name?: string): void {
  const db = getDb();
  const exists = db
    .prepare('SELECT 1 FROM devices WHERE id = ? AND user_id = ?')
    .get(deviceId, userId);
  if (exists) {
    db.prepare(`UPDATE devices SET last_active_at = datetime('now') WHERE id = ?`).run(deviceId);
    return;
  }
  db.prepare(
    `INSERT INTO devices (id, user_id, name, platform, fingerprint, last_active_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).run(deviceId, userId, name ?? '新设备', platform || 'web', deviceId);
}

function issueSession(
  res: Response,
  userId: string,
  deviceId: string
): { accessToken: string; userId: string; deviceId: string } {
  const access = issueAccessToken(userId, deviceId);
  const refresh = issueRefreshToken(userId, deviceId);
  // 持久化 refresh token 哈希到 devices.refresh_token_hash。
  // 设备吊销（DELETE /devices/:id）会清空此列，使被吊销设备的 refresh token
  // 无法再续签 access token——修复此前「refresh_token_hash 从不写入导致吊销形同空操作」的漏洞。
  getDb()
    .prepare('UPDATE devices SET refresh_token_hash = ? WHERE id = ? AND user_id = ?')
    .run(hashRefreshToken(refresh), deviceId, userId);
  writeRefreshCookie(res, refresh);
  return { accessToken: access, userId, deviceId };
}

// ========== GET /auth/status ==========

authRouter.get('/auth/status', (req, res) => {
  const db = getDb();
  const user = loadUser();
  const client = getRequestClient(req);

  let deviceKnown = false;
  if (client.deviceId && user) {
    deviceKnown = !!db.prepare('SELECT 1 FROM devices WHERE id = ?').get(client.deviceId);
  }

  res.json({
    initialized: !!user,
    deviceKnown,
    // 派生 KEK 需要盐，客户端在输入密码前就得拿到。盐不是秘密。
    pwSalt: user ? user.pw_salt.toString('base64') : null,
    kdfParams: { m: KDF_PARAMS.m, t: KDF_PARAMS.t, p: KDF_PARAMS.p, dkLen: KDF_PARAMS.dkLen },
  });
});

// ========== POST /auth/setup ==========

const SetupSchema = z.object({
  /** HKDF(主密码派生, AUTH_INFO)，服务端只存它的 scrypt 哈希 */
  authKey: AuthKeySchema,
  /** HKDF(恢复码派生, AUTH_INFO) */
  recoveryAuthKey: AuthKeySchema,
  /** 主密码 KEK 包装的 masterKey */
  wrappedMasterKeyPw: CiphertextSchema,
  /** 恢复码 KEK 包装的同一把 masterKey */
  wrappedMasterKeyRc: CiphertextSchema,
  pwSalt: SaltSchema,
  rcSalt: SaltSchema,
  deviceName: z.string().min(1).max(64).default('新设备'),
});

authRouter.post('/auth/setup', async (req, res) => {
  const parsed = SetupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const client = getRequestClient(req);
  if (!client.deviceId) {
    res.status(400).json({ error: 'missing_device_id' });
    return;
  }

  const db = getDb();

  // authKey 本身已是 32 字节高熵值，scrypt 只是防止库泄露后被直接拿去登录
  const [authHash, recoveryAuthHash] = await Promise.all([
    hashPassword(d.authKey),
    hashPassword(d.recoveryAuthKey),
  ]);

  const userId = randomUUID();
  const deviceId = client.deviceId;

  // 事务：把「是否已初始化」检查与写入放在同一事务里，
  // 消除两个并发 setup 请求同时通过检查、双双插入的竞态。
  // better-sqlite3 事务在默认 journal_mode 下是串行化的。
  const initialized = db.transaction(() => {
    if (loadUser()) return false;
    db.prepare(
      `INSERT INTO users (
         id, pw_salt, rc_salt, auth_hash, recovery_auth_hash,
         wrapped_master_key_pw, wrapped_master_key_rc,
         kdf_version, kdf_params, recovery_code_set,
         password_hash, master_salt, recovery_hash, recovery_salt, wrapped_master_key
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 2, ?, 1, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      Buffer.from(d.pwSalt, 'base64'),
      Buffer.from(d.rcSalt, 'base64'),
      authHash,
      recoveryAuthHash,
      JSON.stringify(d.wrappedMasterKeyPw),
      JSON.stringify(d.wrappedMasterKeyRc),
      JSON.stringify(KDF_PARAMS),
      // v1 遗留列为 NOT NULL，填入空占位值；v2 不再读取它们
      Buffer.alloc(0),
      Buffer.alloc(0),
      Buffer.alloc(0),
      Buffer.alloc(0),
      ''
    );

    db.prepare(
      `INSERT INTO devices (id, user_id, name, platform, fingerprint)
       VALUES (?, ?, ?, ?, ?)`
    ).run(deviceId, userId, d.deviceName, client.platform || 'web', deviceId);

    db.prepare('INSERT INTO preferences (user_id) VALUES (?)').run(userId);
    return true;
  })();

  if (!initialized) {
    res
      .status(409)
      .json({ error: 'already_initialized', message: '系统已初始化，请用 unlock 登录' });
    return;
  }

  logger.info({ userId, deviceId, platform: client.platform }, '新用户已创建');
  res.json(issueSession(res, userId, deviceId));
});

// ========== POST /auth/unlock ==========

const UnlockSchema = z.object({
  authKey: AuthKeySchema,
  deviceName: z.string().min(1).max(64).optional(),
});

authRouter.post('/auth/unlock', async (req, res) => {
  const parsed = UnlockSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const client = getRequestClient(req);
  if (!client.deviceId) {
    res.status(400).json({ error: 'missing_device_id' });
    return;
  }

  const db = getDb();
  const user = loadUser();
  if (!user) {
    res.status(404).json({ error: 'not_initialized', message: '系统未初始化，请先 setup' });
    return;
  }

  // 账号锁定检查：即使凭据正确也拒绝，防定向爆破
  const lockState: LockoutState = {
    failedAttempts: user.failed_attempts,
    lockedUntil: user.locked_until,
  };
  if (isLocked(lockState)) {
    const waitMs = remainingLockMs(lockState);
    logger.warn({ userId: user.id }, '账号已锁定，拒绝登录');
    res.status(423).json({
      error: 'account_locked',
      message: `账号已锁定，请在 ${Math.ceil(waitMs / 60_000)} 分钟后再试`,
      retryAfterSeconds: Math.ceil(waitMs / 1000),
    });
    return;
  }

  if (!(await verifyPassword(parsed.data.authKey, user.auth_hash))) {
    // 记录失败：累计达阈值后锁定 15 分钟
    const next = recordFailure(lockState);
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(
      next.failedAttempts,
      next.lockedUntil,
      user.id
    );

    const remaining = MAX_FAILED_ATTEMPTS - next.failedAttempts;
    logger.warn(
      { userId: user.id, deviceId: client.deviceId, attempts: next.failedAttempts },
      'authKey 错误'
    );
    if (next.lockedUntil) {
      res.status(423).json({
        error: 'account_locked',
        message: `连续 ${MAX_FAILED_ATTEMPTS} 次凭据错误，账号已锁定 15 分钟`,
        retryAfterSeconds: 900,
      });
    } else {
      res.status(401).json({
        error: 'invalid_credentials',
        message: `凭据错误，剩余尝试次数 ${remaining}`,
      });
    }
    return;
  }

  // 登录成功：清零失败计数
  const clean = recordSuccess();
  db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(
    clean.failedAttempts,
    clean.lockedUntil,
    user.id
  );

  touchDevice(user.id, client.deviceId, client.platform, parsed.data.deviceName);
  logger.info({ userId: user.id, deviceId: client.deviceId }, '用户解锁');

  res.json({
    ...issueSession(res, user.id, client.deviceId),
    // 客户端用主密码 KEK 解封它，得到 masterKey
    wrappedMasterKey: JSON.parse(user.wrapped_master_key_pw) as Ciphertext,
  });
});

// ========== GET /auth/recovery-params ==========

authRouter.get('/auth/recovery-params', (_req, res) => {
  const user = loadUser();
  if (!user) {
    res.status(404).json({ error: 'not_initialized' });
    return;
  }
  res.json({
    rcSalt: user.rc_salt.toString('base64'),
    kdfParams: { m: KDF_PARAMS.m, t: KDF_PARAMS.t, p: KDF_PARAMS.p, dkLen: KDF_PARAMS.dkLen },
  });
});

// ========== POST /auth/recover ==========

const RecoverSchema = z.object({
  recoveryAuthKey: AuthKeySchema,
  deviceName: z.string().min(1).max(64).optional(),
});

authRouter.post('/auth/recover', async (req, res) => {
  const parsed = RecoverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const client = getRequestClient(req);
  if (!client.deviceId) {
    res.status(400).json({ error: 'missing_device_id' });
    return;
  }

  const db = getDb();
  const user = loadUser();
  if (!user) {
    res.status(404).json({ error: 'not_initialized' });
    return;
  }

  // 账号锁定检查：recover 路径与 unlock 共用同一锁定状态，防止定向爆破恢复码
  // 恢复码虽是 10 位 Crockford Base32（2^50 熵），但仍统一防护以避免旁路
  const lockState: LockoutState = {
    failedAttempts: user.failed_attempts,
    lockedUntil: user.locked_until,
  };
  if (isLocked(lockState)) {
    const waitMs = remainingLockMs(lockState);
    logger.warn({ userId: user.id }, '账号已锁定，拒绝 recover');
    res.status(423).json({
      error: 'account_locked',
      message: `账号已锁定，请在 ${Math.ceil(waitMs / 60_000)} 分钟后再试`,
      retryAfterSeconds: Math.ceil(waitMs / 1000),
    });
    return;
  }

  if (!(await verifyPassword(parsed.data.recoveryAuthKey, user.recovery_auth_hash))) {
    // 记录失败：与 unlock 共用计数器，达阈值后锁定 15 分钟
    const next = recordFailure(lockState);
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(
      next.failedAttempts,
      next.lockedUntil,
      user.id
    );

    const remaining = MAX_FAILED_ATTEMPTS - next.failedAttempts;
    logger.warn(
      { userId: user.id, deviceId: client.deviceId, attempts: next.failedAttempts },
      '恢复码错误'
    );
    if (next.lockedUntil) {
      res.status(423).json({
        error: 'account_locked',
        message: `连续 ${MAX_FAILED_ATTEMPTS} 次凭据错误，账号已锁定 15 分钟`,
        retryAfterSeconds: 900,
      });
    } else {
      res.status(401).json({
        error: 'invalid_credentials',
        message: `凭据错误，剩余尝试次数 ${remaining}`,
      });
    }
    return;
  }

  // 恢复成功：清零失败计数
  const clean = recordSuccess();
  db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(
    clean.failedAttempts,
    clean.lockedUntil,
    user.id
  );

  touchDevice(user.id, client.deviceId, client.platform, parsed.data.deviceName);
  getDb()
    .prepare('INSERT INTO audit_log (user_id, device_id, event) VALUES (?, ?, ?)')
    .run(user.id, client.deviceId, 'recover');
  logger.info({ userId: user.id, deviceId: client.deviceId }, '用户通过恢复码登录');

  res.json({
    ...issueSession(res, user.id, client.deviceId),
    // 恢复码 KEK 解封出来的是**同一把** masterKey，历史笔记照常能解开。
    // 客户端拿到后应立刻走 /auth/rewrap 设置新密码。
    wrappedMasterKey: JSON.parse(user.wrapped_master_key_rc) as Ciphertext,
  });
});

// ========== POST /auth/rewrap ==========
//
// 换主密码或换恢复码。masterKey 不变，只是换 KEK 重新包装，
// 因此不会影响任何已有笔记。

const RewrapSchema = z
  .object({
    password: z
      .object({
        authKey: AuthKeySchema,
        salt: SaltSchema,
        wrappedMasterKey: CiphertextSchema,
      })
      .optional(),
    recovery: z
      .object({
        authKey: AuthKeySchema,
        salt: SaltSchema,
        wrappedMasterKey: CiphertextSchema,
      })
      .optional(),
  })
  .refine((v) => v.password ?? v.recovery, { message: 'password 与 recovery 至少提供一个' });

authRouter.post('/auth/rewrap', async (req, res) => {
  const authed = req.user as AuthUser | undefined;
  if (!authed) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const parsed = RewrapSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
    return;
  }

  const db = getDb();
  const updates: string[] = [];
  const params: unknown[] = [];

  if (parsed.data.password) {
    const p = parsed.data.password;
    updates.push('auth_hash = ?', 'pw_salt = ?', 'wrapped_master_key_pw = ?');
    params.push(
      await hashPassword(p.authKey),
      Buffer.from(p.salt, 'base64'),
      JSON.stringify(p.wrappedMasterKey)
    );
  }
  if (parsed.data.recovery) {
    const r = parsed.data.recovery;
    updates.push('recovery_auth_hash = ?', 'rc_salt = ?', 'wrapped_master_key_rc = ?');
    params.push(
      await hashPassword(r.authKey),
      Buffer.from(r.salt, 'base64'),
      JSON.stringify(r.wrappedMasterKey)
    );
  }

  updates.push(`updated_at = datetime('now')`);
  params.push(authed.userId);

  const result = db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  if (result.changes === 0) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }

  db.prepare('INSERT INTO audit_log (user_id, device_id, event) VALUES (?, ?, ?)').run(
    authed.userId,
    authed.deviceId,
    parsed.data.password ? 'password_changed' : 'recovery_code_changed'
  );
  logger.info(
    { userId: authed.userId, password: !!parsed.data.password, recovery: !!parsed.data.recovery },
    '密钥包装已更新'
  );
  res.json({ ok: true });
});

// ========== POST /auth/refresh ==========

authRouter.post('/auth/refresh', (req, res) => {
  const refresh = req.cookies?.dustnote_refresh as string | undefined;
  if (!refresh) {
    res.status(401).json({ error: 'no_refresh_token' });
    return;
  }
  const payload = verifyToken(refresh);
  if (!payload || payload.type !== 'refresh') {
    res.status(401).json({ error: 'invalid_refresh_token' });
    return;
  }

  // 设备被吊销后旧 refresh token 立即失效：
  // 校验库中存储的 refresh_token_hash 与传入 token 的哈希是否一致（恒定时间比较）。
  // 设备行被删除、或 refresh_token_hash 被清空（吊销）均拒绝续签 access token。
  // 修复此前「仅校验设备行存在，而吊销不清行只清 hash，导致吊销后 refresh 仍可成功」的漏洞。
  const row = getDb()
    .prepare('SELECT refresh_token_hash FROM devices WHERE id = ? AND user_id = ?')
    .get(payload.device, payload.sub) as { refresh_token_hash: string | null } | undefined;
  if (
    !row ||
    !row.refresh_token_hash ||
    !safeEqualHash(row.refresh_token_hash, hashRefreshToken(refresh))
  ) {
    res.status(401).json({ error: 'device_revoked', message: '设备已被吊销或 refresh token 已失效' });
    return;
  }

  // 轮换 refresh token：签发新令牌并更新其哈希，缩短单令牌被盗用的窗口
  const newRefresh = issueRefreshToken(payload.sub, payload.device);
  getDb()
    .prepare('UPDATE devices SET refresh_token_hash = ? WHERE id = ? AND user_id = ?')
    .run(hashRefreshToken(newRefresh), payload.device, payload.sub);
  writeRefreshCookie(res, newRefresh);
  res.json({ accessToken: issueAccessToken(payload.sub, payload.device) });
});

// ========== POST /auth/lock ==========

authRouter.post('/auth/lock', (req, res) => {
  // 锁屏是纯客户端行为：清空内存中的 masterKey，服务端只记一条 audit log
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
  const u = getDb().prepare('SELECT id, created_at FROM users WHERE id = ?').get(user.userId) as
    | { id: string; created_at: string }
    | undefined;
  if (!u) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  res.json({ userId: u.id, createdAt: u.created_at });
});
