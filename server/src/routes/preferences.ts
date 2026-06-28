/**
 * 用户偏好设置 API
 */

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import type { AuthUser } from '../middleware/auth.js';

export const preferencesRouter = Router();

const PrefsSchema = z.object({
  theme: z.enum(['mint-dawn', 'mist-blue', 'dusk-forest', 'caramel-warm', 'sakura-pink', 'minimal-white']).optional(),
  mode: z.enum(['light', 'dark', 'auto']).optional(),
  font: z.enum(['system', 'manrope', 'lxgw']).optional(),
  density: z.enum(['comfortable', 'standard', 'compact']).optional(),
  autoLock: z.number().int().min(0).max(1440).optional(),
  language: z.enum(['zh-CN', 'en']).optional(),
});

preferencesRouter.get('/preferences', (req, res) => {
  const user = req.user as AuthUser;
  const db = getDb();
  let row = db.prepare(`SELECT * FROM preferences WHERE user_id = ?`).get(user.userId) as {
    theme: string; mode: string; font: string; density: string; auto_lock: number; language: string;
  } | undefined;
  if (!row) {
    db.prepare(`INSERT INTO preferences (user_id) VALUES (?)`).run(user.userId);
    row = { theme: 'mint-dawn', mode: 'auto', font: 'system', density: 'standard', auto_lock: 15, language: 'zh-CN' };
  }
  res.json({
    theme: row.theme,
    mode: row.mode,
    font: row.font,
    density: row.density,
    autoLock: row.auto_lock,
    language: row.language,
  });
});

preferencesRouter.patch('/preferences', (req, res) => {
  const user = req.user as AuthUser;
  const parsed = PrefsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const db = getDb();
  // 确保 row 存在
  db.prepare(`INSERT OR IGNORE INTO preferences (user_id) VALUES (?)`).run(user.userId);

  const map: Record<string, string> = {
    theme: 'theme', mode: 'mode', font: 'font', density: 'density',
    autoLock: 'auto_lock', language: 'language',
  };
  const updates: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    const col = map[k];
    if (col) {
      updates.push(`${col} = ?`);
      params.push(v);
    }
  }
  if (updates.length === 0) {
    res.json({ ok: true });
    return;
  }
  updates.push(`updated_at = datetime('now')`);
  params.push(user.userId);
  db.prepare(`UPDATE preferences SET ${updates.join(', ')} WHERE user_id = ?`).run(...params);
  res.json({ ok: true });
});
