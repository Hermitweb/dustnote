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
import { ipHash } from '../auth/ip-hash.js';

export const notesRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 密文 blob 上限：单条笔记密文（含 JSON 信封）约 2MB，超出视为异常输入 */
const MAX_CIPHERTEXT_LENGTH = 2_000_000;
/** ISO-8601 时间戳（客户端 new Date().toISOString() 产物），拒绝空串/任意字符串 */
const IsoTimestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/,
    '必须为 ISO-8601 时间戳'
  );

const CreateNoteSchema = z.object({
  /** 客户端预生成的笔记 ID（用于密文 AAD 绑定 noteId||userId，§2.2）；缺省由服务端生成 */
  id: z.string().uuid().optional(),
  /** 密文 blob JSON 字符串（客户端用 masterKey 加密后的明文） */
  ciphertext: z.string().max(MAX_CIPHERTEXT_LENGTH),
  /** key version */
  keyVersion: z.number().default(1),
  isPinned: z.boolean().default(false),
  isFavorite: z.boolean().default(false),
  /** 客户端时间戳 */
  clientUpdatedAt: IsoTimestampSchema,
  folderId: z.string().nullable().optional(),
});

const UpdateNoteSchema = z.object({
  ciphertext: z.string().max(MAX_CIPHERTEXT_LENGTH).optional(),
  keyVersion: z.number().optional(),
  isPinned: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  /** 软删除时间必须为 ISO-8601（空串/非法值直接 400，杜绝绕过 30 天保留期被立即永久删除） */
  deletedAt: IsoTimestampSchema.nullable().optional(),
  clientUpdatedAt: IsoTimestampSchema,
  /** 乐观锁版本号 */
  version: z.number().int().nonnegative(),
  folderId: z.string().nullable().optional(),
});

// ========== GET /notes - 列出笔记 ==========

notesRouter.get('/notes', (req, res) => {
  const user = req.user as AuthUser;
  const since = req.query.since as string | undefined;
  const includeDeleted = req.query.includeDeleted === '1';
  // 分页游标：`${server_updated_at}|${id}`（id 仅做同毫秒并列时的决胜）。
  // 客户端循环携带响应里的 nextCursor 直到 hasMore=false 才算全量。
  // 老客户端不传 cursor 也不读 hasMore，行为与原先一致（只拿第一页）。
  const cursor = req.query.cursor as string | undefined;

  // since 是增量同步游标，必须为 ISO-8601 且不超长，非法值直接 400
  if (
    since !== undefined &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(since)
  ) {
    res.status(400).json({ error: 'invalid_since' });
    return;
  }
  const CURSOR_RE =
    /^[^|]+\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (cursor !== undefined && !CURSOR_RE.test(cursor)) {
    res.status(400).json({ error: 'invalid_cursor' });
    return;
  }

  const db = getDb();
  const PAGE_LIMIT = since ? 1000 : 500;

  const conditions: string[] = ['user_id = ?'];
  const params: unknown[] = [user.userId];
  if (since) {
    conditions.push('server_updated_at > ?');
    params.push(since);
  } else if (!includeDeleted) {
    conditions.push('deleted_at IS NULL');
  }
  if (cursor) {
    const sep = cursor.lastIndexOf('|');
    const cursorTs = cursor.slice(0, sep);
    const cursorId = cursor.slice(sep + 1);
    conditions.push('(server_updated_at < ? OR (server_updated_at = ? AND id < ?))');
    params.push(cursorTs, cursorTs, cursorId);
  }

  // 多取 1 行判断 hasMore，省掉一次 COUNT。
  // 排序不带 is_pinned：游标分页要求跨页排序键稳定，置顶展示由客户端自行排序。
  const rows = db
    .prepare(
      `
    SELECT * FROM notes
    WHERE ${conditions.join(' AND ')}
    ORDER BY server_updated_at DESC, id DESC
    LIMIT ?
  `
    )
    .all(...params, PAGE_LIMIT + 1) as {
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

  const hasMore = rows.length > PAGE_LIMIT;
  const pageRows = hasMore ? rows.slice(0, PAGE_LIMIT) : rows;
  const last = pageRows[pageRows.length - 1];

  res.json({
    notes: pageRows.map((r) => ({
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
    hasMore,
    nextCursor: hasMore && last ? `${last.server_updated_at}|${last.id}` : null,
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
  const id = parsed.data.id ?? randomUUID();

  const db = getDb();
  const result = db.prepare(
    `
    INSERT INTO notes (id, user_id, ciphertext, key_version, is_pinned, is_favorite, client_updated_at, folder_id, version, server_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(id) DO NOTHING
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

  // 幂等重放：响应丢失后重试/多端竞争时同一 id 已存在,收敛到服务端现状返回,
  // 客户端据此放弃本地版本——否则按 5xx 退避重试 8 次后被离线队列静默丢弃
  if (result.changes === 0) {
    const priorRows = db
      .prepare('SELECT user_id, server_updated_at, version FROM notes WHERE id = ?')
      .all(id) as { user_id: string; server_updated_at: string; version: number }[];
    const prior = priorRows[0];
    // 跨用户 id 撞车(uuid,概率可忽略)按 409 拒绝,不把他人行回给当前用户
    if (!prior || prior.user_id !== user.userId) {
      res.status(409).json({ error: 'id_conflict', message: '笔记 ID 冲突' });
      return;
    }
    res.json({
      id,
      serverUpdatedAt: prior.server_updated_at,
      version: prior.version,
      replay: true,
    });
    return;
  }

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
  if (!id || !UUID_RE.test(id)) {
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
    SELECT id, version, is_pinned, is_favorite, deleted_at, ciphertext, key_version, client_updated_at, server_updated_at, folder_id
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
        server_updated_at: string;
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
        serverUpdatedAt: existing.server_updated_at,
      },
    });
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (data.ciphertext !== undefined) {
    // 内容变更：先将旧密文存入 note_versions 作为历史快照
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
  // server_updated_at 与 version 同步递增：增量同步（GET /notes?since=）依赖它
  // 作为游标，任何写路径都必须更新，否则 `server_updated_at > ?` 恒不命中
  updates.push(`server_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`);
  updates.push('version = version + 1');
  params.push(id, user.userId);

  // 事务：历史快照插入 + 旧版本清理 + 主表更新必须原子
  // 任意一步失败回滚，避免出现「快照已写但笔记未更新」或「版本被清理但快照未插入」的不一致
  db.transaction(() => {
    if (data.ciphertext !== undefined) {
      const versionId = randomUUID();
      db.prepare(
        `INSERT INTO note_versions (id, note_id, user_id, ciphertext, key_version, note_version, client_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        versionId,
        id,
        user.userId,
        existing.ciphertext,
        existing.key_version,
        existing.version,
        existing.client_updated_at
      );
      // 保留最近 50 个版本，超出自动清理
      db.prepare(
        `DELETE FROM note_versions
         WHERE note_id = ? AND user_id = ?
           AND id NOT IN (
             SELECT id FROM note_versions
             WHERE note_id = ? AND user_id = ?
             ORDER BY created_at DESC LIMIT 50
           )`
      ).run(id, user.userId, id, user.userId);
    }
    db.prepare(`UPDATE notes SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(
      ...params
    );
  })();

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
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }

  const db = getDb();
  // 软删与「吊销该笔记全部活跃分享」原子执行：笔记进回收站后公开分享链接
  // 不应继续可访问（审计 M6）。恢复不自动重新启用,需重新分享。
  const result = db.transaction(() => {
    const r = db
      .prepare(
        `
      UPDATE notes
      SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          version = version + 1,
          server_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    `
      )
      .run(id, user.userId);
    if (r.changes > 0) {
      db.prepare('UPDATE shares SET revoked = 1 WHERE note_id = ? AND user_id = ? AND revoked = 0').run(
        id,
        user.userId
      );
    }
    return r;
  })();

  if (result.changes === 0) {
    // 幂等语义：对已软删笔记的重复 DELETE 返回 200 而非 404（离线队列重放
    // 场景下 404 会被当作不可恢复 4xx 丢弃;真正不存在才 404）
    const stillThere = db
      .prepare('SELECT deleted_at FROM notes WHERE id = ? AND user_id = ?')
      .all(id, user.userId) as { deleted_at: string | null }[];
    if (stillThere.length > 0) {
      res.json({ ok: true, alreadyDeleted: true });
      return;
    }
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
  if (!id || !UUID_RE.test(id)) {
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
  // 审计：笔记永久删除（不可恢复，留痕用于事故排查）
  db.prepare(
    'INSERT INTO audit_log (user_id, device_id, event, ip_hash, meta) VALUES (?, ?, ?, ?, ?)'
  ).run(
    user.userId,
    user.deviceId,
    'note_permanent_delete',
    ipHash(req),
    JSON.stringify({ noteId: id })
  );
  broadcastNoteChanged(user.userId, { id, op: 'permanent_delete' });
  res.json({ ok: true });
});

// ========== GET /notes/:id/versions - 列出历史版本 ==========

notesRouter.get('/notes/:id/versions', (req, res) => {
  const user = req.user as AuthUser;
  const id = req.params.id;
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }

  const db = getDb();
  // 先确认笔记属于该用户
  const note = db.prepare('SELECT id FROM notes WHERE id = ? AND user_id = ?').get(id, user.userId);
  if (!note) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const rows = db
    .prepare(
      `SELECT id, note_version, key_version, client_updated_at, created_at
       FROM note_versions
       WHERE note_id = ? AND user_id = ?
       ORDER BY created_at DESC
       LIMIT 100`
    )
    .all(id, user.userId) as {
    id: string;
    note_version: number;
    key_version: number;
    client_updated_at: string;
    created_at: string;
  }[];

  res.json({
    versions: rows.map((r) => ({
      id: r.id,
      noteVersion: r.note_version,
      keyVersion: r.key_version,
      clientUpdatedAt: r.client_updated_at,
      createdAt: r.created_at,
    })),
  });
});

// ========== GET /notes/:id/versions/:versionId - 获取历史版本密文 ==========

notesRouter.get('/notes/:id/versions/:versionId', (req, res) => {
  const user = req.user as AuthUser;
  const { id, versionId } = req.params;
  if (!id || !versionId || !UUID_RE.test(id) || !UUID_RE.test(versionId)) {
    res.status(400).json({ error: 'missing_params' });
    return;
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, ciphertext, key_version, note_version, client_updated_at, created_at
       FROM note_versions
       WHERE id = ? AND note_id = ? AND user_id = ?`
    )
    .get(versionId, id, user.userId) as
    | {
        id: string;
        ciphertext: Buffer | string;
        key_version: number;
        note_version: number;
        client_updated_at: string;
        created_at: string;
      }
    | undefined;

  if (!row) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  res.json({
    id: row.id,
    ciphertext: String(row.ciphertext),
    keyVersion: row.key_version,
    noteVersion: row.note_version,
    clientUpdatedAt: row.client_updated_at,
    createdAt: row.created_at,
  });
});

// ========== POST /notes/:id/versions/:versionId/restore - 恢复历史版本 ==========

notesRouter.post('/notes/:id/versions/:versionId/restore', (req, res) => {
  const user = req.user as AuthUser;
  const { id, versionId } = req.params;
  if (!id || !versionId || !UUID_RE.test(id) || !UUID_RE.test(versionId)) {
    res.status(400).json({ error: 'missing_params' });
    return;
  }

  const parsed = z
    .object({
      version: z.number().int().nonnegative(),
      clientUpdatedAt: IsoTimestampSchema,
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }

  const db = getDb();
  // 获取历史版本密文
  const versionRow = db
    .prepare(
      `SELECT ciphertext, key_version FROM note_versions
       WHERE id = ? AND note_id = ? AND user_id = ?`
    )
    .get(versionId, id, user.userId) as
    | { ciphertext: Buffer | string; key_version: number }
    | undefined;

  if (!versionRow) {
    res.status(404).json({ error: 'version_not_found' });
    return;
  }

  // 检查当前笔记状态（乐观锁）
  const existing = db
    .prepare('SELECT version FROM notes WHERE id = ? AND user_id = ?')
    .get(id, user.userId) as { version: number } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'note_not_found' });
    return;
  }

  if (existing.version !== parsed.data.version) {
    res.status(409).json({
      error: 'version_mismatch',
      message: '数据已被其他设备更新',
      current: existing.version,
    });
    return;
  }

  // 恢复前先将当前密文存为历史版本（与正常更新一致）
  const currentNote = db
    .prepare(
      'SELECT ciphertext, key_version, version, client_updated_at FROM notes WHERE id = ? AND user_id = ?'
    )
    .get(id, user.userId) as {
    ciphertext: Buffer | string;
    key_version: number;
    version: number;
    client_updated_at: string;
  };

  // 事务：当前密文快照 + 历史密文覆盖必须原子，避免快照写入但覆盖失败导致数据不一致
  db.transaction(() => {
    const snapshotId = randomUUID();
    db.prepare(
      `INSERT INTO note_versions (id, note_id, user_id, ciphertext, key_version, note_version, client_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      snapshotId,
      id,
      user.userId,
      currentNote.ciphertext,
      currentNote.key_version,
      currentNote.version,
      currentNote.client_updated_at
    );

    // 用历史版本的密文覆盖当前笔记（server_updated_at 同步更新，维持增量同步游标）
    db.prepare(
      `UPDATE notes SET ciphertext = ?, key_version = ?, version = version + 1, client_updated_at = ?,
          server_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ?`
    ).run(
      String(versionRow.ciphertext),
      versionRow.key_version,
      parsed.data.clientUpdatedAt,
      id,
      user.userId
    );

    // 恢复路径同样受 50 版本上限约束（审计 L8：此前 restore 快照后不清理,
    // 版本数可短暂超限,与 PATCH 的清理保持一致）
    db.prepare(
      `DELETE FROM note_versions
       WHERE note_id = ? AND user_id = ?
         AND id NOT IN (
           SELECT id FROM note_versions
           WHERE note_id = ? AND user_id = ?
           ORDER BY created_at DESC LIMIT 50
         )`
    ).run(id, user.userId, id, user.userId);
  })();

  const updated = db
    .prepare('SELECT server_updated_at, version FROM notes WHERE id = ?')
    .get(id) as { server_updated_at: string; version: number };

  broadcastNoteChanged(user.userId, { id, op: 'update' });

  logger.info({ userId: user.userId, noteId: id, versionId }, '笔记已恢复到历史版本');
  res.json({
    id,
    serverUpdatedAt: updated.server_updated_at,
    version: updated.version,
  });
});
