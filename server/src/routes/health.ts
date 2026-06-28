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

    res.json({
      ok,
      uptime: process.uptime(),
      version: process.env.npm_package_version ?? '0.1.0',
      db: ok ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
});
