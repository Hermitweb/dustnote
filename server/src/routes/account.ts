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
 *
 * 白名单：表名来自下方常量集合，绝不接受外部输入，杜绝 SQL 注入风险。
 * 即便调用方误传表名，也会因不在集合内而被跳过。
 */
const USER_DATA_TABLES = [
  'devices',
  'notes',
  'note_versions',
  'folders',
  'tags',
  'shares',
  'preferences',
  'templates',
] as const;
const USER_DATA_TABLE_SET = new Set<string>(USER_DATA_TABLES);

function countUserData(db: ReturnType<typeof getDb>, userId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of USER_DATA_TABLES) {
    // t 来自编译期常量集合，非用户输入；二次校验集合成员以做纵深防御
    if (!USER_DATA_TABLE_SET.has(t)) continue;
    const r = db.prepare(`SELECT COUNT(*) as c FROM ${t} WHERE user_id = ?`).get(userId) as {
      c: number;
    };
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

  logger.info({ userId, countsBefore: result.countsBefore }, '账户已删除（GDPR Article 17）');

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
    // 显式列：排除服务端凭据校验产物（password_hash / master_salt /
    //   recovery_hash / recovery_salt），它们对迁移无价值，且一旦导出文件
    //   泄漏会带来离线爆破风险。保留 wrapped_master_key(_pw/_rc) + pw_salt/rc_salt
    //   主密钥的密文，是迁移后用主密码重新解开笔记的唯一凭证。
    const userRow = db
      .prepare<
        unknown[],
        Record<string, unknown>
      >(`SELECT id, pw_salt, rc_salt, wrapped_master_key, wrapped_master_key_pw, wrapped_master_key_rc, kdf_version, kdf_params, recovery_code_set, created_at, updated_at FROM users WHERE id = ?`)
      .get(userId);
    if (!userRow) return null;

    // 显式列：排除 refresh_token_hash（服务端会话密钥哈希，迁移无用，
    //   泄漏有被离线爆破风险；新设备登录会重新生成）。
    const devices = db
      .prepare<
        unknown[],
        Record<string, unknown>[]
      >(`SELECT id, user_id, name, platform, fingerprint, last_active_at, created_at FROM devices WHERE user_id = ?`)
      .all(userId);
    const notes = db
      .prepare<
        unknown[],
        Record<string, unknown>[]
      >(`SELECT id, user_id, ciphertext, key_version, is_pinned, is_favorite, deleted_at, version, folder_id, client_updated_at, server_updated_at, created_at, updated_at FROM notes WHERE user_id = ?`)
      .all(userId);
    // 历史版本：补齐此前遗漏的 note_versions，否则导出后用户无法重建笔记历史。
    const noteVersions = db
      .prepare<
        unknown[],
        Record<string, unknown>[]
      >(`SELECT id, note_id, ciphertext, key_version, note_version, client_updated_at, created_at FROM note_versions WHERE user_id = ?`)
      .all(userId);
    // 笔记-标签关联：note_tags 无 user_id 列，通过 JOIN notes 限定到当前用户，
    // 否则导出后客户端无法重建笔记与标签的多对多关系。
    const noteTags = db
      .prepare<
        unknown[],
        Record<string, unknown>[]
      >(`SELECT nt.note_id, nt.tag_id FROM note_tags nt INNER JOIN notes n ON nt.note_id = n.id WHERE n.user_id = ?`)
      .all(userId);
    // 显式列替代 SELECT *：避免未来给 folders/tags/preferences 增加内部字段时意外泄漏。
    const folders = db
      .prepare<
        unknown[],
        Record<string, unknown>[]
      >(`SELECT id, user_id, name, parent_id, icon, sort_order, created_at FROM folders WHERE user_id = ?`)
      .all(userId);
    const tags = db
      .prepare<
        unknown[],
        Record<string, unknown>[]
      >(`SELECT id, user_id, name, color FROM tags WHERE user_id = ?`)
      .all(userId);
    const preferences = db
      .prepare<
        unknown[],
        Record<string, unknown>[]
      >(`SELECT user_id, theme, mode, font, density, auto_lock, language, updated_at FROM preferences WHERE user_id = ?`)
      .all(userId);
    const shares = db
      .prepare<
        unknown[],
        Record<string, unknown>[]
      >(`SELECT id, note_id, token, ciphertext, wrapped_share_key, password_hash IS NOT NULL AS has_password, expires_at, view_count, revoked, created_at FROM shares WHERE user_id = ?`)
      .all(userId);
    const templates = db
      .prepare<
        unknown[],
        Record<string, unknown>[]
      >(`SELECT id, user_id, name, description, category, icon, content, is_preset, sort_order, created_at, updated_at FROM templates WHERE user_id = ?`)
      .all(userId);

    return {
      user: userRow,
      devices,
      notes,
      noteVersions,
      noteTags,
      folders,
      tags,
      preferences,
      shares,
      templates,
    };
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
