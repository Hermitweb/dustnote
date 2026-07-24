/**
 * 笔记 CRUD API（E2EE）
 * 服务端只存密文，所有明文处理在客户端完成
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import { logger } from '../logger.js';
import type { AuthUser } from '../middleware/auth.js';
import { broadcastNoteChanged } from '../services/sync-ws.js';

export const notesRouter = Router();

const CreateNoteSchema = z.object({
  /** 密文 blob JSON 字符串（客户端用 masterKey 加密后的明文） */
  ciphertext: z.string(),
  /** key version */
  keyVersion: z.number().default(1),
  isPinned: z.boolean().default(false),
  isFavorite: z.boolean().default(false),
  /** 客户端时间戳 */
  clientUpdatedAt: z.string(),
  folderId: z.string().nullable().optional(),
});

const UpdateNoteSchema = z.object({
  ciphertext: z.string().optional(),
  keyVersion: z.number().optional(),
  isPinned: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  deletedAt: z.string().nullable().optional(),
  clientUpdatedAt: z.string(),
  /** 乐观锁版本号 */
  version: z.number().int().nonnegative(),
  folderId: z.string().nullable().optional(),
});

// ========== GET /notes - 列出笔记 ==========

notesRouter.get('/notes', (req, res) => {
  const user = req.user as AuthUser;
  const since = req.query.since as string | undefined;
  const includeDeleted = req.query.includeDeleted === '1';

  const db = getDb();
  let rows: {
    id: string;
    ciphertext: Buffer | string;
    key_version: number;
    is_pinned: number;
    is_favorite: number;
    deleted_at: string | null;
    version: number;
    client_updated_at: string;
    server_updated_at: string;
    folder_id: string | null;
  }[];

  if (since) {
    rows = db
      .prepare(
        `
      SELECT * FROM notes
      WHERE user_id = ? AND server_updated_at > ?
      ORDER BY server_updated_at DESC
    `
      )
      .all(user.userId, since) as typeof rows;
  } else {
    const where = includeDeleted ? 'user_id = ?' : 'user_id = ? AND deleted_at IS NULL';
    rows = db
      .prepare(
        `
      SELECT * FROM notes WHERE ${where} ORDER BY is_pinned DESC, server_updated_at DESC LIMIT 500
    `
      )
      .all(user.userId) as typeof rows;
  }

  res.json({
    notes: rows.map((r) => ({
      id: r.id,
      // ciphertext 列虽是 BLOB，但写入时存的是 JSON 字符串；读出时统一转字符串
      ciphertext: String(r.ciphertext),
      keyVersion: r.key_version,
      isPinned: !!r.is_pinned,
      isFavorite: !!r.is_favorite,
      deletedAt: r.deleted_at,
      version: r.version,
      clientUpdatedAt: r.client_updated_at,
      serverUpdatedAt: r.server_updated_at,
      folderId: r.folder_id,
    })),
  });
});

// ========== POST /notes - 新建 ==========

notesRouter.post('/notes', (req, res) => {
  const user = req.user as AuthUser;
  const parsed = CreateNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const { ciphertext, keyVersion, isPinned, isFavorite, clientUpdatedAt, folderId } = parsed.data;
  const id = randomUUID();

  const db = getDb();
  db.prepare(
    `
    INSERT INTO notes (id, user_id, ciphertext, key_version, is_pinned, is_favorite, client_updated_at, folder_id, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `
  ).run(
    id,
    user.userId,
    ciphertext,
    keyVersion,
    isPinned ? 1 : 0,
    isFavorite ? 1 : 0,
    clientUpdatedAt,
    folderId ?? null
  );

  const note = db.prepare('SELECT server_updated_at FROM notes WHERE id = ?').get(id) as {
    server_updated_at: string;
  };

  broadcastNoteChanged(user.userId, { id, op: 'create' });

  logger.info({ userId: user.userId, noteId: id }, '笔记已创建');
  res.status(201).json({
    id,
    serverUpdatedAt: note.server_updated_at,
    version: 1,
  });
});

// ========== PATCH /notes/:id - 更新 ==========

notesRouter.patch('/notes/:id', (req, res) => {
  const user = req.user as AuthUser;
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }

  const parsed = UpdateNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const data = parsed.data;
  const db = getDb();

  const existing = db
    .prepare(
      `
    SELECT id, version, is_pinned, is_favorite, deleted_at, ciphertext, key_version, client_updated_at, folder_id
    FROM notes WHERE id = ? AND user_id = ?
  `
    )
    .get(id, user.userId) as
    | {
        id: string;
        version: number;
        is_pinned: number;
        is_favorite: number;
        deleted_at: string | null;
        ciphertext: Buffer | string;
        key_version: number;
        client_updated_at: string;
        folder_id: string | null;
      }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  if (existing.version !== data.version) {
    res.status(409).json({
      error: 'version_mismatch',
      message: '数据已被其他设备更新',
      current: {
        id: existing.id,
        version: existing.version,
        isPinned: !!existing.is_pinned,
        isFavorite: !!existing.is_favorite,
        deletedAt: existing.deleted_at,
        ciphertext: String(existing.ciphertext),
        keyVersion: existing.key_version,
        clientUpdatedAt: existing.client_updated_at,
        folderId: existing.folder_id,
        serverUpdatedAt: '', // 服务端会立即返
      },
    });
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (data.ciphertext !== undefined) {
    updates.push('ciphertext = ?');
    params.push(data.ciphertext);
    updates.push('key_version = ?');
    params.push(data.keyVersion ?? existing.key_version);
  }
  if (data.isPinned !== undefined) {
    updates.push('is_pinned = ?');
    params.push(data.isPinned ? 1 : 0);
  }
  if (data.isFavorite !== undefined) {
    updates.push('is_favorite = ?');
    params.push(data.isFavorite ? 1 : 0);
  }
  if (data.deletedAt !== undefined) {
    updates.push('deleted_at = ?');
    params.push(data.deletedAt);
  }
  if (data.folderId !== undefined) {
    updates.push('folder_id = ?');
    params.push(data.folderId);
  }
  updates.push('client_updated_at = ?');
  params.push(data.clientUpdatedAt);
  updates.push('version = version + 1');
  params.push(id, user.userId);

  db.prepare(`UPDATE notes SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);

  const updated = db
    .prepare(
      `
    SELECT server_updated_at, version FROM notes WHERE id = ?
  `
    )
    .get(id) as { server_updated_at: string; version: number };

  broadcastNoteChanged(user.userId, { id, op: 'update' });

  res.json({
    id,
    serverUpdatedAt: updated.server_updated_at,
    version: updated.version,
  });
});

// ========== DELETE /notes/:id - 软删除 ==========

notesRouter.delete('/notes/:id', (req, res) => {
  const user = req.user as AuthUser;
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }

  const db = getDb();
  const result = db
    .prepare(
      `
    UPDATE notes SET deleted_at = datetime('now'), version = version + 1
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `
    )
    .run(id, user.userId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  broadcastNoteChanged(user.userId, { id, op: 'delete' });
  res.json({ ok: true });
});

// ========== DELETE /notes/:id/permanent - 永久删除 ==========

notesRouter.delete('/notes/:id/permanent', (req, res) => {
  const user = req.user as AuthUser;
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }

  const db = getDb();
  const result = db
    .prepare(
      `
    DELETE FROM notes WHERE id = ? AND user_id = ?
  `
    )
    .run(id, user.userId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  broadcastNoteChanged(user.userId, { id, op: 'permanent_delete' });
  res.json({ ok: true });
});
