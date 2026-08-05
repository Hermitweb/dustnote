/**
 * 文件夹 API（明文，不加密）
 * 文件夹名不敏感，可让服务端可见以便全文搜索优化
 * 但仍支持"隐藏模式"——客户端可把文件夹名加密后存
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import type { AuthUser } from '../middleware/auth.js';

export const foldersRouter = Router();

const FolderSchema = z.object({
  name: z.string().min(1).max(64),
  parentId: z.string().nullable().optional(),
  icon: z.string().max(16).optional(),
});

foldersRouter.get('/folders', (req, res) => {
  const user = req.user as AuthUser;
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT id, name, parent_id, icon, sort_order, created_at
    FROM folders WHERE user_id = ? ORDER BY sort_order, created_at
  `
    )
    .all(user.userId) as {
    id: string;
    name: string;
    parent_id: string | null;
    icon: string | null;
    sort_order: number;
    created_at: string;
  }[];
  res.json({
    folders: rows.map((r) => ({
      id: r.id,
      name: r.name,
      parentId: r.parent_id,
      icon: r.icon,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
    })),
  });
});

foldersRouter.post('/folders', (req, res) => {
  const user = req.user as AuthUser;
  const parsed = FolderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const id = randomUUID();
  const db = getDb();
  db.prepare(
    `
    INSERT INTO folders (id, user_id, name, parent_id, icon)
    VALUES (?, ?, ?, ?, ?)
  `
  ).run(id, user.userId, parsed.data.name, parsed.data.parentId ?? null, parsed.data.icon ?? null);
  res.status(201).json({ id });
});

foldersRouter.patch('/folders/:id', (req, res) => {
  const user = req.user as AuthUser;
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }
  const parsed = FolderSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const db = getDb();
  const updates: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    const col = { name: 'name', parentId: 'parent_id', icon: 'icon' }[k];
    if (col) {
      updates.push(`${col} = ?`);
      params.push(v);
    }
  }
  if (updates.length === 0) {
    res.json({ ok: true });
    return;
  }
  params.push(id, user.userId);
  const r = db
    .prepare(`UPDATE folders SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
    .run(...params);
  if (r.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ ok: true });
});

foldersRouter.delete('/folders/:id', (req, res) => {
  const user = req.user as AuthUser;
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }
  const db = getDb();
  // 事务：删除文件夹 + 清空其下笔记 folder_id 原子化，
  // 不隐式依赖 FK ON DELETE SET NULL 兜底
  const r = db.transaction(() => {
    const del = db.prepare(`DELETE FROM folders WHERE id = ? AND user_id = ?`).run(id, user.userId);
    if (del.changes === 0) return 0;
    // 该文件夹下的笔记 folder_id 置空
    db.prepare(`UPDATE notes SET folder_id = NULL WHERE folder_id = ? AND user_id = ?`).run(
      id,
      user.userId
    );
    return 1;
  })();
  if (r === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ ok: true });
});
