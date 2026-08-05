/**
 * 分享 API（secret-link 方案）
 *
 * 服务端全程只见密文：
 * - 主人本地随机生成 shareKey，用它加密 {title, content} 后上传
 * - shareKey 放在链接的 URL fragment（`#` 后面）里，浏览器不会把 fragment
 *   发给服务端，所以服务端拿到 token 也解不开内容
 * - 另存一份用 masterKey 包装的 shareKey，供主人换设备后还原完整链接
 *
 * 可选的分享密码是一道**独立**的访问控制：它只决定能不能下载到密文，
 * 与解密无关。两者都需要才能看到内容。
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomBytes, randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import { logger } from '../logger.js';
import type { Ciphertext } from '@dustnote/shared';
import type { AuthUser } from '../middleware/auth.js';
import { broadcastShareChanged } from '../services/sync-ws.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { ipHash } from '../auth/ip-hash.js';
import {
  isLocked,
  recordFailureAtomic,
  remainingLockMs,
  MAX_FAILED_ATTEMPTS,
  LOCK_DURATION_MS,
  type LockoutState,
} from '../auth/lockout.js';

export const sharesRouter = Router();
export const publicSharesRouter = Router();

const CiphertextSchema = z.object({
  v: z.number(),
  k: z.number(),
  n: z.string().min(1).max(64),
  c: z.string().min(1).max(400_000),
});

const CreateShareSchema = z.object({
  noteId: z.string().uuid(),
  /** shareKey 加密的 {title, content} */
  ciphertext: CiphertextSchema,
  /** masterKey 包装的 shareKey，服务端解不开 */
  wrappedShareKey: CiphertextSchema,
  password: z.string().min(4).max(64).optional(),
  expiresIn: z
    .number()
    .int()
    .positive()
    .max(365 * 24 * 3600)
    .optional(), // 秒
});

// ========== 登录用户操作 ==========

sharesRouter.post('/shares', async (req, res) => {
  try {
    const user = req.user as AuthUser;
    const parsed = CreateShareSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const db = getDb();
    const note = db
      .prepare(
        `
      SELECT id, ciphertext, key_version, deleted_at
      FROM notes WHERE id = ? AND user_id = ?
    `
      )
      .get(parsed.data.noteId, user.userId) as
      | { id: string; ciphertext: string; key_version: number; deleted_at: string | null }
      | undefined;
    if (!note) {
      res.status(404).json({ error: 'note_not_found' });
      return;
    }
    if (note.deleted_at) {
      res.status(400).json({ error: 'note_deleted' });
      return;
    }

    const id = randomUUID();
    const token = randomBytes(24).toString('base64url');
    const passwordHash = parsed.data.password ? await hashPassword(parsed.data.password) : null;
    const expiresAt = parsed.data.expiresIn
      ? new Date(Date.now() + parsed.data.expiresIn * 1000).toISOString()
      : null;

    // 事务：分享写入 + 审计日志原子化，避免审计缺失或分享残留
    db.transaction(() => {
      db.prepare(
        `
        INSERT INTO shares (id, note_id, user_id, token, ciphertext, wrapped_share_key, password_hash, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        id,
        note.id,
        user.userId,
        token,
        JSON.stringify(parsed.data.ciphertext),
        JSON.stringify(parsed.data.wrappedShareKey),
        passwordHash,
        expiresAt
      );

      // 审计：分享创建。带密码 / 过期时间写入 meta 便于事后排查
      db.prepare(
        'INSERT INTO audit_log (user_id, device_id, event, ip_hash, meta) VALUES (?, ?, ?, ?, ?)'
      ).run(
        user.userId,
        user.deviceId,
        'share_create',
        ipHash(req),
        JSON.stringify({ shareId: id, noteId: note.id, hasPassword: !!passwordHash, expiresAt })
      );
    })();

    logger.info({ userId: user.userId, shareId: id, hasPassword: !!passwordHash }, '分享已创建');
    broadcastShareChanged(user.userId, { id, op: 'create' });
    res.status(201).json({
      id,
      token,
      url: `/share/${token}`,
      expiresAt,
    });
  } catch (err) {
    logger.error({ err }, '创建分享失败');
    res.status(500).json({ error: 'internal_error' });
  }
});

sharesRouter.get('/shares', (req, res) => {
  const user = req.user as AuthUser;
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT id, note_id, token, wrapped_share_key, password_hash IS NOT NULL AS has_password,
           expires_at, view_count, revoked, created_at
    FROM shares WHERE user_id = ? ORDER BY created_at DESC
  `
    )
    .all(user.userId) as {
    id: string;
    note_id: string;
    token: string;
    wrapped_share_key: string;
    has_password: number;
    expires_at: string | null;
    view_count: number;
    revoked: number;
    created_at: string;
  }[];
  res.json({
    shares: rows.map((r) => ({
      id: r.id,
      noteId: r.note_id,
      token: r.token,
      // 标题不再存服务端；主人用本地已解密的笔记按 noteId 自行显示
      wrappedShareKey: JSON.parse(r.wrapped_share_key) as Ciphertext,
      hasPassword: !!r.has_password,
      expiresAt: r.expires_at,
      viewCount: r.view_count,
      revoked: !!r.revoked,
      createdAt: r.created_at,
    })),
  });
});

sharesRouter.delete('/shares/:id', (req, res) => {
  const user = req.user as AuthUser;
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }
  const db = getDb();
  // 事务：吊销 + 审计日志原子化，避免磁盘满/DB锁超时导致吊销成功但无审计行
  const result = db.transaction(() => {
    const r = db
      .prepare(
        `
      UPDATE shares SET revoked = 1 WHERE id = ? AND user_id = ?
    `
      )
      .run(id, user.userId);
    if (r.changes === 0) return { ok: false as const };
    // 审计：分享吊销
    db.prepare(
      'INSERT INTO audit_log (user_id, device_id, event, ip_hash, meta) VALUES (?, ?, ?, ?, ?)'
    ).run(
      user.userId,
      user.deviceId,
      'share_revoke',
      ipHash(req),
      JSON.stringify({ shareId: id })
    );
    return { ok: true as const };
  })();
  if (!result.ok) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  broadcastShareChanged(user.userId, { id, op: 'revoke' });
  res.json({ ok: true });
});

// ========== 公开访问（无需登录）==========
//
// 安全注意：
// 1. 同时支持 GET 和 POST：GET 用于无密码场景 / 历史链接兼容；
//    密码推荐走 POST body（避免出现在 URL / 反代访问日志 / 浏览器历史里）。
//    服务端两种方法都接受，让旧客户端不破坏的同时让新客户端能升级。
// 2. 单分享失败计数：与账号锁定策略一致，6 次错误密码 → 该分享锁 15 分钟。
//    防止单条分享链接被定向爆破。

const PublicAccessQuerySchema = z.object({
  password: z.string().optional(),
});

const PublicAccessBodySchema = z.object({
  password: z.string().optional(),
});

/** 读取密码：POST 优先取 body，其次回退到 query（GET 向后兼容） */
function readPassword(req: { query: unknown; body: unknown; method: string }): string | undefined {
  // POST：从 body 读取
  if (req.method === 'POST') {
    const parsed = PublicAccessBodySchema.safeParse(req.body);
    if (parsed.success) return parsed.data.password;
    return undefined;
  }
  // GET：从 query 读取（兼容旧链接 / 邮件中的预览请求）
  const parsed = PublicAccessQuerySchema.safeParse(req.query);
  if (parsed.success) return parsed.data.password;
  return undefined;
}

async function handlePublicShareAccess(req: import('express').Request, res: import('express').Response): Promise<void> {
  try {
    const token = req.params.token;
    if (!token) {
      res.status(400).json({ error: 'missing_token' });
      return;
    }
    const db = getDb();
    const share = db
      .prepare(
        `
      SELECT s.id, s.note_id, s.password_hash, s.expires_at, s.revoked, s.view_count, s.created_at,
             s.ciphertext, s.failed_attempts, s.locked_until
      FROM shares s
      WHERE s.token = ?
    `
      )
      .get(token) as
      | {
          id: string;
          note_id: string;
          password_hash: string | null;
          expires_at: string | null;
          revoked: number;
          view_count: number;
          created_at: string;
          ciphertext: string;
          failed_attempts: number;
          locked_until: string | null;
        }
      | undefined;

    if (!share) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (share.revoked) {
      res.status(410).json({ error: 'revoked', message: '分享已被吊销' });
      return;
    }
    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      res.status(410).json({ error: 'expired', message: '分享已过期' });
      return;
    }

    // 密码校验
    if (share.password_hash) {
      // 单分享锁定检查：与账号锁定复用同一策略，但作用在 shares 表
      const lockState: LockoutState = {
        failedAttempts: share.failed_attempts,
        lockedUntil: share.locked_until,
      };
      if (isLocked(lockState)) {
        const waitMs = remainingLockMs(lockState);
        logger.warn({ shareId: share.id }, '分享已锁定，拒绝访问');
        res.status(423).json({
          error: 'share_locked',
          message: `该分享已被锁定，请在 ${Math.ceil(waitMs / 60_000)} 分钟后再试`,
          retryAfterSeconds: Math.ceil(waitMs / 1000),
        });
        return;
      }

      const pwd = readPassword(req);
      if (!pwd) {
        res.status(401).json({ error: 'password_required', message: '该分享需要密码' });
        return;
      }
      const ok = await verifyPassword(pwd, share.password_hash);
      if (!ok) {
        // 记录失败：原子更新计数，达到阈值则锁定该分享 15 分钟。
        // 先读后写在 await 两侧会被并发请求丢失更新，绕过锁定阈值。
        const next = recordFailureAtomic(db, 'shares', share.id);
        logger.warn(
          { shareId: share.id, attempts: next.failedAttempts, locked: next.failedAttempts >= MAX_FAILED_ATTEMPTS },
          '分享密码错误'
        );
        const retryAfterMs = next.lockedUntil && isLocked(next)
          ? LOCK_DURATION_MS
          : 0;
        res.status(401).json({
          error: 'invalid_password',
          message: '密码错误',
          retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
        });
        return;
      }
      // 成功：清零失败计数
      db.prepare(
        'UPDATE shares SET failed_attempts = 0, locked_until = NULL WHERE id = ?'
      ).run(share.id);
    }

    // 更新查看次数
    db.prepare('UPDATE shares SET view_count = view_count + 1 WHERE id = ?').run(share.id);

    res.json({
      // 只下发密文；解密所需的 shareKey 在链接 fragment 里，从未到过服务端
      ciphertext: JSON.parse(share.ciphertext) as Ciphertext,
      noteId: share.note_id,
      createdAt: share.created_at,
      expiresAt: share.expires_at,
    });
  } catch (err) {
    logger.error({ err }, '访问分享失败');
    res.status(500).json({ error: 'internal_error' });
  }
}

publicSharesRouter.get('/share/public/:token', (req, res) => void handlePublicShareAccess(req, res));
publicSharesRouter.post('/share/public/:token', (req, res) => void handlePublicShareAccess(req, res));
