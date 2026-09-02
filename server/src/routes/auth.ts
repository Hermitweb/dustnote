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

import { Router, type Request, type Response, type NextFunction } from 'express';
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
  recordFailureAtomic,
  recordSuccess,
  remainingLockMs,
  MAX_FAILED_ATTEMPTS,
  LOCK_DURATION_MS,
  type LockoutState,
} from '../auth/lockout.js';
import { ipHash } from '../auth/ip-hash.js';
import type { AuthUser } from '../middleware/auth.js';

export const authRouter = Router();

/** 设备默认名称（重复使用的字符串提取为常量，避免默认值漂移） */
const DEFAULT_DEVICE_NAME = '新设备';

/**
 * 包装 async 路由处理器，让 rejected promise 走 Express 错误处理中间件
 * （app.ts 末尾的兜底 500 处理器），而非变成 unhandledRejection 打死进程。
 * Express 4 原生不捕获 async handler 的 rejection。
 */
const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

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

/** 允许的客户端平台（与 migrations 的 devices.platform CHECK 约束一致） */
const ALLOWED_PLATFORMS = new Set(['web', 'desktop', 'android', 'ios', 'miniprogram']);
const MAX_DEVICE_ID_LENGTH = 128;

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

/**
 * 校验客户端标识头。auth 公开路由（setup/unlock/recover/status）绕过 version-check
 * 中间件，因此这里补上等价校验：deviceId 非空且不超长、platform 在允许集合内。
 * 非法值返回 400，而不是让非法 platform 触发 DB CHECK 约束回滚 / 500。
 */
function validateClientHeaders(client: { deviceId: string; platform: string }): string | null {
  if (!client.deviceId || client.deviceId.length > MAX_DEVICE_ID_LENGTH) {
    return 'invalid_device_id';
  }
  if (client.platform && !ALLOWED_PLATFORMS.has(client.platform)) {
    return 'invalid_platform';
  }
  return null;
}

function writeRefreshCookie(res: Response, token: string): void {
  res.cookie('dustnote_refresh', token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    maxAge: REFRESH_TTL * 1000,
    path: '/api/v1/auth',
  });
}

/**
 * 读取 refresh token：cookie（web 标准）或 X-Refresh-Token header。
 * header 通道为 React Native 等无法持久化 HTTP-only cookie 的客户端提供
 * refresh 能力（v2.5.18：修复 mobile 锁屏 15 分钟后 token 过期无法恢复）。
 * 安全性等同：两者都是 30 天轮换 refresh token,服务端只存哈希。
 */
function readRefreshToken(req: Request): string | undefined {
  const header = req.headers?.['x-refresh-token'];
  if (typeof header === 'string' && header.length > 0) return header;
  return req.cookies?.dustnote_refresh as string | undefined;
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
  totp_secret: string | null;
  totp_enabled: number;
  totp_last_counter: number;
  kdf_params: string;
}

function loadUser(): UserRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, pw_salt, rc_salt, auth_hash, recovery_auth_hash,
              wrapped_master_key_pw, wrapped_master_key_rc,
              failed_attempts, locked_until, totp_secret, totp_enabled, totp_last_counter, kdf_params
       FROM users WHERE auth_hash IS NOT NULL ORDER BY id LIMIT 1`
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
    // 纵深防御：UPDATE 补齐 user_id 条件，避免未来 SELECT/UPDATE 之间引入异步时跨用户写
    db.prepare(
      `UPDATE devices SET last_active_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?`
    ).run(deviceId, userId);
    return;
  }
  // Device count limit: max 20 per user, evict oldest when exceeded
  const cnt = (
    db.prepare('SELECT COUNT(*) AS c FROM devices WHERE user_id = ?').get(userId) as { c: number }
  ).c;
  if (cnt >= 20) {
    db.prepare(
      `DELETE FROM devices WHERE user_id = ? AND id IN (
         SELECT id FROM devices WHERE user_id = ? ORDER BY last_active_at ASC LIMIT ?
       )`
    ).run(userId, userId, cnt - 19);
  }
  db.prepare(
    `INSERT INTO devices (id, user_id, name, platform, fingerprint, last_active_at)
     VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
  ).run(deviceId, userId, name ?? DEFAULT_DEVICE_NAME, platform || 'web', deviceId);
}

function issueSession(
  res: Response,
  userId: string,
  deviceId: string
): { accessToken: string; userId: string; deviceId: string; refreshToken: string } {
  const access = issueAccessToken(userId, deviceId);
  const refresh = issueRefreshToken(userId, deviceId);
  // 持久化 refresh token 哈希到 devices.refresh_token_hash。
  // 设备吊销（DELETE /devices/:id）会清空此列，使被吊销设备的 refresh token
  // 无法再续签 access token——修复此前「refresh_token_hash 从不写入导致吊销形同空操作」的漏洞。
  getDb()
    .prepare('UPDATE devices SET refresh_token_hash = ? WHERE id = ? AND user_id = ?')
    .run(hashRefreshToken(refresh), deviceId, userId);
  writeRefreshCookie(res, refresh);
  // refreshToken 进 body:RN 等无 cookie 持久化能力的客户端自管轮换（v2.5.18）
  return { accessToken: access, userId, deviceId, refreshToken: refresh };
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

  // 读取实际存储的 KDF 参数（web=argon2id, mobile=pbkdf2）
  let kdfParams = KDF_PARAMS;
  if (user) {
    try {
      kdfParams = JSON.parse(user.kdf_params);
    } catch { /* fallback to default */ }
  }

  res.json({
    initialized: !!user,
    deviceKnown,
    // 派生 KEK 需要盐，客户端在输入密码前就得拿到。盐不是秘密。
    pwSalt: user ? user.pw_salt.toString('base64') : null,
    totpEnabled: user ? !!user.totp_enabled : false,
    kdfParams,
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
  deviceName: z.string().min(1).max(64).default(DEFAULT_DEVICE_NAME),
  /** 客户端 KDF 参数（web=argon2id, mobile=miniprogram=pbkdf2） */
  kdfParams: z.object({
    algorithm: z.string(),
    m: z.number(),
    t: z.number(),
    p: z.number(),
    iterations: z.number().optional(),
    dkLen: z.number(),
  }).optional(),
});

authRouter.post(
  '/auth/setup',
  asyncHandler(async (req, res) => {
    const parsed = SetupSchema.safeParse(req.body);
    if (!parsed.success) {
      // 不回传 zod flatten 原始结构（会暴露字段约束细节给攻击者），与 unlock/recover 保持一致
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const d = parsed.data;
    const client = getRequestClient(req);
    const headerErr = validateClientHeaders(client);
    if (headerErr) {
      res.status(400).json({ error: headerErr });
      return;
    }
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
        JSON.stringify(d.kdfParams ?? KDF_PARAMS),
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
  })
);

// ========== POST /auth/unlock ==========

const UnlockSchema = z.object({
  authKey: AuthKeySchema,
  deviceName: z.string().min(1).max(64).optional(),
  totpCode: z.string().length(6).regex(/^\d{6}$/).optional(),
});

authRouter.post(
  '/auth/unlock',
  asyncHandler(async (req, res) => {
    const parsed = UnlockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const client = getRequestClient(req);
    const headerErr = validateClientHeaders(client);
    if (headerErr) {
      res.status(400).json({ error: headerErr });
      return;
    }
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
      getDb()
        .prepare('INSERT INTO audit_log (user_id, device_id, event, ip_hash) VALUES (?, ?, ?, ?)')
        .run(user.id, client.deviceId, 'login_locked', ipHash(req));
      res.status(423).json({
        error: 'account_locked',
        message: `账号已锁定，请在 ${Math.ceil(waitMs / 60_000)} 分钟后再试`,
        retryAfterSeconds: Math.ceil(waitMs / 1000),
      });
      return;
    }

    if (!(await verifyPassword(parsed.data.authKey, user.auth_hash))) {
      // 记录失败：单条 UPDATE 原子完成「+1 计数 + 达阈值置锁」。
      // 不能先读后写在 await 两侧（并发请求会丢失更新，绕过锁定阈值）。
      const next = recordFailureAtomic(db, 'users', user.id);

      const remaining = MAX_FAILED_ATTEMPTS - next.failedAttempts;
      logger.warn(
        { userId: user.id, deviceId: client.deviceId, attempts: next.failedAttempts },
        'authKey 错误'
      );
      getDb()
        .prepare('INSERT INTO audit_log (user_id, device_id, event, ip_hash) VALUES (?, ?, ?, ?)')
        .run(user.id, client.deviceId, 'login_failed', ipHash(req));
      if (next.lockedUntil && isLocked(next)) {
        res.status(423).json({
          error: 'account_locked',
          message: `连续 ${MAX_FAILED_ATTEMPTS} 次凭据错误，账号已锁定 15 分钟`,
          retryAfterSeconds: Math.ceil(LOCK_DURATION_MS / 1000),
        });
      } else {
        res.status(401).json({
          error: 'invalid_credentials',
          message: `凭据错误，剩余尝试次数 ${Math.max(remaining, 0)}`,
        });
      }
      return;
    }

    // 登录成功：清零失败计数（移到 2FA 通过之后——TOTP 失败也计入
    // 防爆破锁定，否则已知主密码的攻击者可无限爆破 6 位验证码）
    // 2FA 检查：密码正确后，若启用了 TOTP 则要求验证码
    if (user.totp_enabled && user.totp_secret) {
      if (!parsed.data.totpCode) {
        res.status(401).json({ error: 'totp_required', message: '请输入两步验证码' });
        return;
      }
      // 防重放：verifyTotpWithCounter 返回命中窗口的计数器，落库后
      // 同一窗口的验证码不可再次使用
      const vr = verifyTotpWithCounter(parsed.data.totpCode, user.totp_secret, user.totp_last_counter);
      if (!vr.ok) {
        const next = recordFailureAtomic(db, 'users', user.id);
        logger.warn({ userId: user.id, attempts: next.failedAttempts }, 'TOTP 验证码错误');
        res.status(401).json({ error: 'invalid_totp', message: '两步验证码错误' });
        return;
      }
      db.prepare('UPDATE users SET totp_last_counter = ? WHERE id = ?').run(vr.counter, user.id);
      const clean = recordSuccess();
      db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(
        clean.failedAttempts,
        clean.lockedUntil,
        user.id
      );
    } else {
      const clean = recordSuccess();
      db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(
        clean.failedAttempts,
        clean.lockedUntil,
        user.id
      );
    }

    touchDevice(user.id, client.deviceId, client.platform, parsed.data.deviceName);
    // 审计：登录成功（含失败 / 锁定事件，构成完整认证审计链）
    getDb()
      .prepare('INSERT INTO audit_log (user_id, device_id, event, ip_hash) VALUES (?, ?, ?, ?)')
      .run(user.id, client.deviceId, 'login_success', ipHash(req));
    logger.info({ userId: user.id, deviceId: client.deviceId }, '用户解锁');

    res.json({
      ...issueSession(res, user.id, client.deviceId),
      // 客户端用主密码 KEK 解封它，得到 masterKey
      wrappedMasterKey: JSON.parse(user.wrapped_master_key_pw) as Ciphertext,
    });
  })
);

// ========== GET /auth/recovery-params ==========

authRouter.get('/auth/recovery-params', (_req, res) => {
  const user = loadUser();
  if (!user) {
    res.status(404).json({ error: 'not_initialized' });
    return;
  }
  let kdfParams = KDF_PARAMS;
  try {
    kdfParams = JSON.parse(user.kdf_params);
  } catch { /* fallback */ }
  res.json({
    rcSalt: user.rc_salt.toString('base64'),
    kdfParams,
  });
});

// ========== POST /auth/recover ==========

const RecoverSchema = z.object({
  recoveryAuthKey: AuthKeySchema,
  deviceName: z.string().min(1).max(64).optional(),
});

authRouter.post(
  '/auth/recover',
  asyncHandler(async (req, res) => {
    const parsed = RecoverSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const client = getRequestClient(req);
    const headerErr = validateClientHeaders(client);
    if (headerErr) {
      res.status(400).json({ error: headerErr });
      return;
    }
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
      // 记录失败：原子更新（与 unlock 共用计数器，防并发丢失更新绕过锁定）
      const next = recordFailureAtomic(db, 'users', user.id);

      const remaining = MAX_FAILED_ATTEMPTS - next.failedAttempts;
      logger.warn(
        { userId: user.id, deviceId: client.deviceId, attempts: next.failedAttempts },
        '恢复码错误'
      );
      if (next.lockedUntil && isLocked(next)) {
        res.status(423).json({
          error: 'account_locked',
          message: `连续 ${MAX_FAILED_ATTEMPTS} 次凭据错误，账号已锁定 15 分钟`,
          retryAfterSeconds: Math.ceil(LOCK_DURATION_MS / 1000),
        });
      } else {
        res.status(401).json({
          error: 'invalid_credentials',
          message: `凭据错误，剩余尝试次数 ${Math.max(remaining, 0)}`,
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
      .prepare('INSERT INTO audit_log (user_id, device_id, event, ip_hash) VALUES (?, ?, ?, ?)')
      .run(user.id, client.deviceId, 'recover', ipHash(req));
    logger.info({ userId: user.id, deviceId: client.deviceId }, '用户通过恢复码登录');

    res.json({
      ...issueSession(res, user.id, client.deviceId),
      // 恢复码 KEK 解封出来的是**同一把** masterKey，历史笔记照常能解开。
      // 客户端拿到后应立刻走 /auth/rewrap 设置新密码。
      wrappedMasterKey: JSON.parse(user.wrapped_master_key_rc) as Ciphertext,
    });
  })
);

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

authRouter.post(
  '/auth/rewrap',
  asyncHandler(async (req, res) => {
    const authed = req.user as AuthUser | undefined;
    if (!authed) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const parsed = RewrapSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
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

    updates.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`);
    params.push(authed.userId);

    const result = db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    if (result.changes === 0) {
      res.status(404).json({ error: 'user_not_found' });
      return;
    }

    db.prepare(
      'INSERT INTO audit_log (user_id, device_id, event, ip_hash) VALUES (?, ?, ?, ?)'
    ).run(
      authed.userId,
      authed.deviceId,
      parsed.data.password ? 'password_changed' : 'recovery_code_changed',
      ipHash(req)
    );
    logger.info(
      { userId: authed.userId, password: !!parsed.data.password, recovery: !!parsed.data.recovery },
      '密钥包装已更新'
    );
    res.json({ ok: true });
  })
);

// ========== POST /auth/refresh ==========

authRouter.post('/auth/refresh', (req, res) => {
  const refresh = readRefreshToken(req);
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
    res
      .status(401)
      .json({ error: 'device_revoked', message: '设备已被吊销或 refresh token 已失效' });
    return;
  }

  // 轮换 refresh token：签发新令牌并更新其哈希，缩短单令牌被盗用的窗口
  const newRefresh = issueRefreshToken(payload.sub, payload.device);
  getDb()
    .prepare('UPDATE devices SET refresh_token_hash = ? WHERE id = ? AND user_id = ?')
    .run(hashRefreshToken(newRefresh), payload.device, payload.sub);
  writeRefreshCookie(res, newRefresh);
  // header 通道（RN 等）：新 refresh token 也放 body,客户端自管轮换
  res.json({ accessToken: issueAccessToken(payload.sub, payload.device), refreshToken: newRefresh });
});

// ========== POST /auth/lock ==========

authRouter.post('/auth/lock', (req, res) => {
  // 锁屏是纯客户端行为：清空内存中的 masterKey，服务端只记一条 audit log
  const user = req.user as AuthUser | undefined;
  if (user) {
    getDb()
      .prepare('INSERT INTO audit_log (user_id, device_id, event, ip_hash) VALUES (?, ?, ?, ?)')
      .run(user.userId, user.deviceId, 'lock', ipHash(req));
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

// ========== 2FA / TOTP ==========

import { generateTotpSecret, generateTotpUri, verifyTotp, verifyTotpWithCounter } from '../auth/totp.js';

const Verify2faSchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/),
});

const Disable2faSchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/),
});

/**
 * POST /auth/2fa/setup — 生成 TOTP 密钥和 QR 码 URI
 *
 * 返回 base32 密钥和 otpauth URI，客户端用 QR 码库生成二维码供用户扫描。
 * 此时 2FA 尚未启用，需调用 /auth/2fa/enable 验证后才生效。
 */
authRouter.post('/auth/2fa/setup', (req, res) => {
  const user = req.user as AuthUser | undefined;
  if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }

  const u = getDb().prepare('SELECT totp_enabled FROM users WHERE id = ?').get(user.userId) as
    | { totp_enabled: number }
    | undefined;
  if (!u) { res.status(404).json({ error: 'user_not_found' }); return; }
  if (u.totp_enabled) { res.status(400).json({ error: 'already_enabled' }); return; }

  const secret = generateTotpSecret();
  const uri = generateTotpUri(secret, user.userId);

  // 暂存密钥（未启用），等 /auth/2fa/enable 验证后才设 totp_enabled=1
  getDb().prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, user.userId);

  logger.info({ userId: user.userId }, '2FA 密钥已生成');
  res.json({ secret, uri });
});

/**
 * POST /auth/2fa/enable — 验证 TOTP 码并启用 2FA
 *
 * 用户扫描 QR 码后输入 6 位验证码，服务端验证通过后启用 2FA。
 */
authRouter.post('/auth/2fa/enable', (req, res) => {
  const user = req.user as AuthUser | undefined;
  if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }

  const parsed = Verify2faSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid_code' }); return; }

  const u = getDb().prepare('SELECT totp_secret, totp_enabled FROM users WHERE id = ?').get(user.userId) as
    | { totp_secret: string | null; totp_enabled: number }
    | undefined;
  if (!u) { res.status(404).json({ error: 'user_not_found' }); return; }
  if (u.totp_enabled) { res.status(400).json({ error: 'already_enabled' }); return; }
  if (!u.totp_secret) { res.status(400).json({ error: 'setup_first' }); return; }

  if (!verifyTotp(parsed.data.code, u.totp_secret)) {
    res.status(401).json({ error: 'invalid_code' });
    return;
  }

  getDb().prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(user.userId);
  getDb()
    .prepare('INSERT INTO audit_log (user_id, device_id, event, ip_hash) VALUES (?, ?, ?, ?)')
    .run(user.userId, user.deviceId, '2fa_enable', ipHash(req));

  logger.info({ userId: user.userId }, '2FA 已启用');
  res.json({ ok: true, enabled: true });
});

/**
 * POST /auth/2fa/disable — 验证 TOTP 码后禁用 2FA
 */
authRouter.post('/auth/2fa/disable', (req, res) => {
  const user = req.user as AuthUser | undefined;
  if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }

  const parsed = Disable2faSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid_code' }); return; }

  const u = getDb().prepare('SELECT totp_secret, totp_enabled FROM users WHERE id = ?').get(user.userId) as
    | { totp_secret: string | null; totp_enabled: number }
    | undefined;
  if (!u) { res.status(404).json({ error: 'user_not_found' }); return; }
  if (!u.totp_enabled || !u.totp_secret) { res.status(400).json({ error: 'not_enabled' }); return; }

  if (!verifyTotp(parsed.data.code, u.totp_secret)) {
    res.status(401).json({ error: 'invalid_code' });
    return;
  }

  getDb().prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(user.userId);
  getDb()
    .prepare('INSERT INTO audit_log (user_id, device_id, event, ip_hash) VALUES (?, ?, ?, ?)')
    .run(user.userId, user.deviceId, '2fa_disable', ipHash(req));

  logger.info({ userId: user.userId }, '2FA 已禁用');
  res.json({ ok: true, enabled: false });
});

/**
 * GET /auth/2fa/status — 查询当前用户的 2FA 状态
 */
authRouter.get('/auth/2fa/status', (req, res) => {
  const user = req.user as AuthUser | undefined;
  if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }

  const u = getDb().prepare('SELECT totp_enabled FROM users WHERE id = ?').get(user.userId) as
    | { totp_enabled: number }
    | undefined;
  if (!u) { res.status(404).json({ error: 'user_not_found' }); return; }

  res.json({ enabled: !!u.totp_enabled });
});
