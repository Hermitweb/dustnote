/**
 * 标签 API（明文，不加密）
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import type { AuthUser } from '../middleware/auth.js';

export const tagsRouter = Router();

const TagSchema = z.object({
  name: z.string().min(1).max(32),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

tagsRouter.get('/tags', (req, res) => {
  const user = req.user as AuthUser;
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT t.id, t.name, t.color, COUNT(nt.note_id) AS count
    FROM tags t
    LEFT JOIN note_tags nt ON t.id = nt.tag_id
    WHERE t.user_id = ?
    GROUP BY t.id
    ORDER BY count DESC, t.name
  `
    )
    .all(user.userId) as { id: string; name: string; color: string | null; count: number }[];
  res.json({ tags: rows });
});

tagsRouter.post('/tags', (req, res) => {
  const user = req.user as AuthUser;
  const parsed = TagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const id = randomUUID();
  const db = getDb();
  try {
    db.prepare(
      `
      INSERT INTO tags (id, user_id, name, color) VALUES (?, ?, ?, ?)
    `
    ).run(id, user.userId, parsed.data.name, parsed.data.color ?? null);
    res.status(201).json({ id });
  } catch (err) {
    res.status(409).json({ error: 'tag_exists' });
  }
});

tagsRouter.delete('/tags/:id', (req, res) => {
  const user = req.user as AuthUser;
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }
  const db = getDb();
  const r = db.prepare(`DELETE FROM tags WHERE id = ? AND user_id = ?`).run(id, user.userId);
  if (r.changes === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ ok: true });
});

/** 给笔记打标签 / 取消标签 */
const NoteTagSchema = z.object({
  noteId: z.string().uuid(),
  tagId: z.string().uuid(),
});

tagsRouter.post('/note-tags', (req, res) => {
  const user = req.user as AuthUser;
  const parsed = NoteTagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const db = getDb();
  // 确认 note 与 tag 属于同一 user
  const note = db
    .prepare('SELECT 1 FROM notes WHERE id = ? AND user_id = ?')
    .get(parsed.data.noteId, user.userId);
  const tag = db
    .prepare('SELECT 1 FROM tags WHERE id = ? AND user_id = ?')
    .get(parsed.data.tagId, user.userId);
  if (!note || !tag) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  try {
    db.prepare('INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(
      parsed.data.noteId,
      parsed.data.tagId
    );
    res.status(201).json({ ok: true });
  } catch {
    res.status(409).json({ error: 'already_tagged' });
  }
});

tagsRouter.delete('/note-tags', (req, res) => {
  const user = req.user as AuthUser;
  const parsed = NoteTagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const db = getDb();
  db.prepare(
    `
    DELETE FROM note_tags
    WHERE note_id = ? AND tag_id = ?
      AND note_id IN (SELECT id FROM notes WHERE user_id = ?)
  `
  ).run(parsed.data.noteId, parsed.data.tagId, user.userId);
  res.json({ ok: true });
});
