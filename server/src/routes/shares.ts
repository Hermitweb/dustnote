/**
 * 分享 API
 * - 创建分享：token + 可选密码 + 可选过期
 * - 公开访问：通过 /share/public/:token 读取（需要密码则必须带 hashed）
 *
 * 设计：服务端只存密文，访客拿到 token 后还需要可选密码才能下载密文
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomBytes, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { getDb } from '../db.js';
import { logger } from '../logger.js';
import type { AuthUser } from '../middleware/auth.js';
import { broadcastShareChanged } from '../services/sync-ws.js';

export const sharesRouter = Router();
export const publicSharesRouter = Router();

const CreateShareSchema = z.object({
  noteId: z.string().uuid(),
  // v1 简化：owner 在客户端解密后把可分享的明文快照上传
  // 真正的 E2EE 分享（owner 在线解密 / per-share key 包装）见 v1.5
  title: z.string().min(1).max(256),
  content: z.string().max(200_000),
  password: z.string().min(4).max(64).optional(),
  expiresIn: z.number().int().positive().max(365 * 24 * 3600).optional(), // 秒
});

// ========== 登录用户操作 ==========

sharesRouter.post('/shares', (req, res) => {
  const user = req.user as AuthUser;
  const parsed = CreateShareSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const db = getDb();
  const note = db.prepare(`
    SELECT id, ciphertext, key_version, deleted_at
    FROM notes WHERE id = ? AND user_id = ?
  `).get(parsed.data.noteId, user.userId) as { id: string; ciphertext: string; key_version: number; deleted_at: string | null } | undefined;
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
  const passwordHash = parsed.data.password
    ? createHash('sha256').update(parsed.data.password).digest()
    : null;
  const expiresAt = parsed.data.expiresIn
    ? new Date(Date.now() + parsed.data.expiresIn * 1000).toISOString()
    : null;

  db.prepare(`
    INSERT INTO shares (id, note_id, user_id, token, password_hash, expires_at, title, content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, note.id, user.userId, token, passwordHash, expiresAt, parsed.data.title, parsed.data.content);

  logger.info({ userId: user.userId, shareId: id, hasPassword: !!passwordHash }, '分享已创建');
  broadcastShareChanged(user.userId, { id, op: 'create' });
  res.status(201).json({
    id,
    token,
    hasPassword: !!passwordHash,
    expiresAt,
    url: `/share/${token}`,
  });
});

sharesRouter.get('/shares', (req, res) => {
  const user = req.user as AuthUser;
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, note_id, token, password_hash IS NOT NULL AS has_password,
           expires_at, view_count, revoked, created_at, title
    FROM shares WHERE user_id = ? ORDER BY created_at DESC
  `).all(user.userId) as { id: string; note_id: string; token: string; has_password: number; expires_at: string | null; view_count: number; revoked: number; created_at: string; title: string | null }[];
  res.json({
    shares: rows.map((r) => ({
      id: r.id,
      noteId: r.note_id,
      token: r.token,
      hasPassword: !!r.has_password,
      expiresAt: r.expires_at,
      viewCount: r.view_count,
      revoked: !!r.revoked,
      createdAt: r.created_at,
      title: r.title ?? '(无标题)',
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
  const r = db.prepare(`
    UPDATE shares SET revoked = 1 WHERE id = ? AND user_id = ?
  `).run(id, user.userId);
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

publicSharesRouter.get('/share/public/:token', (req, res) => {
  const token = req.params.token;
  if (!token) {
    res.status(400).json({ error: 'missing_token' });
    return;
  }
  const db = getDb();
  const share = db.prepare(`
    SELECT s.id, s.note_id, s.password_hash, s.expires_at, s.revoked, s.view_count, s.created_at,
           s.title, s.content
    FROM shares s
    WHERE s.token = ?
  `).get(token) as { id: string; note_id: string; password_hash: Buffer | null; expires_at: string | null; revoked: number; view_count: number; created_at: string; title: string; content: string } | undefined;

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
    const candidate = createHash('sha256').update(parsed.data.password).digest();
    const stored = new Uint8Array(share.password_hash);
    if (candidate.length !== stored.length || !timingSafeEqual(candidate, stored)) {
      logger.warn({ shareId: share.id }, '分享密码错误');
      res.status(401).json({ error: 'invalid_password' });
      return;
    }
  }

  // 更新查看次数
  db.prepare('UPDATE shares SET view_count = view_count + 1 WHERE id = ?').run(share.id);

  res.json({
    title: share.title,
    content: share.content,
    noteId: share.note_id,
    createdAt: share.created_at,
    expiresAt: share.expires_at,
  });
});
