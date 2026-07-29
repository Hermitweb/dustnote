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
  const r = db
    .prepare(
      `
    UPDATE shares SET revoked = 1 WHERE id = ? AND user_id = ?
  `
    )
    .run(id, user.userId);
  if (r.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  broadcastShareChanged(user.userId, { id, op: 'revoke' });
  res.json({ ok: true });
});

// ========== 公开访问（无需登录）==========

const PublicAccessSchema = z.object({
  password: z.string().optional(),
});

publicSharesRouter.get('/share/public/:token', async (req, res) => {
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
             s.ciphertext
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
      const parsed = PublicAccessSchema.safeParse(req.query);
      if (!parsed.success || !parsed.data.password) {
        res.status(401).json({ error: 'password_required', message: '该分享需要密码' });
        return;
      }
      const ok = await verifyPassword(parsed.data.password, share.password_hash);
      if (!ok) {
        logger.warn({ shareId: share.id }, '分享密码错误');
        res.status(401).json({ error: 'invalid_password' });
        return;
      }
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
});
