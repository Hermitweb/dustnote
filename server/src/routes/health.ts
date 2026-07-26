/**
 * 健康检查
 */

import { Router } from 'express';
import { getDb } from '../db.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    const ok = result?.ok === 1;

    // 扩展指标：笔记数、文件夹数（仅在 DB 正常时查询）
    let notesCount = 0;
    let foldersCount = 0;
    if (ok) {
      notesCount = (
        db.prepare('SELECT COUNT(*) AS c FROM notes WHERE deleted_at IS NULL').get() as {
          c: number;
        }
      ).c;
      foldersCount = (db.prepare('SELECT COUNT(*) AS c FROM folders').get() as { c: number }).c;
    }

    res.json({
      ok,
      uptime: process.uptime(),
      version: process.env.npm_package_version ?? '0.1.0',
      db: ok ? 'ok' : 'error',
      notesCount,
      foldersCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
});
