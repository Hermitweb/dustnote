/**
 * 模板 API
 *
 * - 预设模板（is_preset=1, user_id=NULL）：全用户共享，content 为明文 Markdown
 * - 自定义模板（is_preset=0, user_id=<uid>）：用户私有，content 为 ciphertext JSON（E2EE）
 *
 * 服务端不解析 content，只做存取。客户端按 isPreset 标志决定明文读取还是解密。
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import type { AuthUser } from '../middleware/auth.js';

export const templatesRouter = Router();

const TemplateSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(200).default(''),
  category: z
    .enum(['blank', 'journal', 'meeting', 'todo', 'reading', 'project', 'custom'])
    .default('custom'),
  icon: z.string().max(16).default('📄'),
  /** 自定义模板为 ciphertext JSON；预设模板为明文（但预设模板不可由客户端创建） */
  content: z.string().max(2_000_000),
  sortOrder: z.number().int().nonnegative().default(100),
});

// GET /templates — 列出预设模板 + 当前用户的自定义模板
templatesRouter.get('/templates', (req, res) => {
  const user = req.user as AuthUser;
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT id, user_id, name, description, category, icon, content, is_preset, sort_order, created_at, updated_at
    FROM templates
    WHERE is_preset = 1 OR user_id = ?
    ORDER BY is_preset DESC, sort_order ASC, created_at ASC
  `
    )
    .all(user.userId) as {
    id: string;
    user_id: string | null;
    name: string;
    description: string;
    category: string;
    icon: string;
    content: string;
    is_preset: number;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }[];

  res.json({
    templates: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      name: r.name,
      description: r.description,
      category: r.category,
      icon: r.icon,
      content: r.content,
      isPreset: !!r.is_preset,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
});

// POST /templates — 创建自定义模板（预设模板只能由迁移脚本 seed）
templatesRouter.post('/templates', (req, res) => {
  const user = req.user as AuthUser;
  const parsed = TemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', message: parsed.error.message });
    return;
  }
  const id = randomUUID();
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO templates (id, user_id, name, description, category, icon, content, is_preset, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `
  ).run(
    id,
    user.userId,
    parsed.data.name,
    parsed.data.description,
    parsed.data.category,
    parsed.data.icon,
    parsed.data.content,
    parsed.data.sortOrder,
    now,
    now
  );
  res.status(201).json({ id });
});

// PATCH /templates/:id — 更新自定义模板（预设模板不可改）
templatesRouter.patch('/templates/:id', (req, res) => {
  const user = req.user as AuthUser;
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }
  const parsed = TemplateSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', message: parsed.error.message });
    return;
  }
  const db = getDb();
  // 确认是当前用户的自定义模板（非预设）
  const existing = db
    .prepare('SELECT is_preset FROM templates WHERE id = ? AND user_id = ?')
    .get(id, user.userId) as { is_preset: number } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (existing.is_preset) {
    res.status(403).json({ error: 'preset_readonly', message: '预设模板不可修改' });
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  const colMap: Record<string, string> = {
    name: 'name',
    description: 'description',
    category: 'category',
    icon: 'icon',
    content: 'content',
    sortOrder: 'sort_order',
  };
  for (const [k, v] of Object.entries(parsed.data)) {
    const col = colMap[k];
    if (col) {
      updates.push(`${col} = ?`);
      params.push(v);
    }
  }
  if (updates.length === 0) {
    res.json({ ok: true });
    return;
  }
  updates.push(`updated_at = ?`);
  params.push(new Date().toISOString());
  params.push(id, user.userId);
  db.prepare(`UPDATE templates SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(
    ...params
  );
  res.json({ ok: true });
});

// DELETE /templates/:id — 删除自定义模板（预设模板不可删）
templatesRouter.delete('/templates/:id', (req, res) => {
  const user = req.user as AuthUser;
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: 'missing_id' });
    return;
  }
  const db = getDb();
  const existing = db
    .prepare('SELECT is_preset FROM templates WHERE id = ? AND user_id = ?')
    .get(id, user.userId) as { is_preset: number } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (existing.is_preset) {
    res.status(403).json({ error: 'preset_readonly', message: '预设模板不可删除' });
    return;
  }
  db.prepare(`DELETE FROM templates WHERE id = ? AND user_id = ?`).run(id, user.userId);
  res.json({ ok: true });
});
