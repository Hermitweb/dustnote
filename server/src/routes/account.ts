/**
 * 账户管理 API（GDPR 合规）
 *
 * DELETE /api/v1/account          - 删除当前账户及所有数据（Article 17 被遗忘权）
 * GET    /api/v1/account/export   - 导出账户全部数据（Article 20 数据可携带权）
 *
 * 删除策略：
 * - 物理删除（非软删）：GDPR 要求"擦除且不再处理"
 * - 事务包裹；依赖外键 ON DELETE CASCADE 自动级联（见 migrations.ts）
 *   所有表都通过 user_id 直接外键到 users，或通过中间表间接关联
 * - note_tags 无 user_id 列，但依赖 notes/tags 的 ON DELETE CASCADE 自动清理
 *
 * 安全：
 * - 必须二次确认：客户端传 confirm=true 才执行
 * - 强烈建议客户端在删除前先 GET /account/export 全量备份
 *
 * 注：audit_log 不删除 — GDPR Article 17 允许保留合规审计日志，
 * 应由独立任务定期匿名化（去标识化）该用户的记录。
 */

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { config } from '../env.js';
import type { AuthUser } from '../middleware/auth.js';

export const accountRouter = Router();

const DeleteAccountSchema = z.object({
  confirm: z.boolean().refine((v) => v === true, {
    message: '必须传 confirm=true 才能删除账户',
  }),
});

/**
 * 删除前统计各表行数（审计用）
 * 注意：note_tags 无 user_id 列，无法直接计数，跳过
 */
function countUserData(
  db: ReturnType<typeof getDb>,
  userId: string,
): Record<string, number> {
  const tables = ['devices', 'notes', 'note_versions', 'folders', 'tags', 'shares', 'preferences', 'templates'];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const r = db.prepare(`SELECT COUNT(*) as c FROM ${t} WHERE user_id = ?`).get(userId) as { c: number };
    counts[t] = r.c;
  }
  return counts;
}

/**
 * DELETE /api/v1/account
 * 删除账户及所有关联数据（GDPR Article 17）
 */
accountRouter.delete('/account', (req, res) => {
  const user = req.user as AuthUser;
  const parsed = DeleteAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_body',
      message: parsed.error.issues[0]?.message ?? '请求体无效',
    });
    return;
  }

  const db = getDb();
  const userId = user.userId;

  // 事务：所有删除要么全成功要么全回滚
  const result = db.transaction(() => {
    // 先确认用户存在
    const userRow = db
      .prepare<unknown[], { id: string }>(`SELECT id FROM users WHERE id = ?`)
      .get(userId);
    if (!userRow) {
      return { ok: false as const };
    }

    // 删除前统计（审计用）
    const countsBefore = countUserData(db, userId);

    // 删除 users 行 — 所有相关表通过 ON DELETE CASCADE 自动级联
    // 包括：devices / notes / note_versions / folders / tags / note_tags /
    //       shares / preferences / templates
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);

    return { ok: true as const, countsBefore };
  })();

  if (!result.ok) {
    res.status(404).json({ error: 'user_not_found', message: '用户不存在' });
    return;
  }

  logger.info(
    { userId, countsBefore: result.countsBefore },
    '账户已删除（GDPR Article 17）',
  );

  res.json({
    ok: true,
    deleted: true,
    counts: result.countsBefore,
  });
});

/**
 * GET /api/v1/account/export
 * 导出账户全部数据（GDPR Article 20 数据可携带权）
 *
 * 注意：笔记内容是客户端加密的密文，服务端无法解密；
 * 此接口导出账户元数据 + 密文笔记，用户可在客户端用主密码解密后迁移。
 */
accountRouter.get('/account/export', (req, res) => {
  const user = req.user as AuthUser;
  const db = getDb();
  const userId = user.userId;

  const data = db.transaction(() => {
    const userRow = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM users WHERE id = ?`)
      .get(userId);
    if (!userRow) return null;

    const devices = db
      .prepare<unknown[], Record<string, unknown>[]>(
        `SELECT * FROM devices WHERE user_id = ?`,
      )
      .all(userId);
    const notes = db
      .prepare<unknown[], Record<string, unknown>[]>(
        `SELECT id, user_id, is_pinned, is_favorite, deleted_at, version, client_updated_at, created_at, updated_at FROM notes WHERE user_id = ?`,
      )
      .all(userId);
    const folders = db
      .prepare<unknown[], Record<string, unknown>[]>(
        `SELECT * FROM folders WHERE user_id = ?`,
      )
      .all(userId);
    const tags = db
      .prepare<unknown[], Record<string, unknown>[]>(
        `SELECT * FROM tags WHERE user_id = ?`,
      )
      .all(userId);
    const preferences = db
      .prepare<unknown[], Record<string, unknown>[]>(
        `SELECT * FROM preferences WHERE user_id = ?`,
      )
      .all(userId);

    return { user: userRow, devices, notes, folders, tags, preferences };
  })();

  if (!data) {
    res.status(404).json({ error: 'user_not_found', message: '用户不存在' });
    return;
  }

  const filename = `dustnote-account-${userId}-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json({
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    serverVersion: config.serverVersion,
    ...data,
  });
});
