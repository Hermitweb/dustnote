/**
 * 账户导出 schema 漂移回归（审计 H1）
 *
 * 事故背景：account.ts 的 export SELECT 引用了 notes 表不存在的
 * created_at/updated_at 列——端点 100% 返回 500,且无任何测试覆盖。
 * 根因是手写 SQL 与真实 schema 漂移。
 *
 * 这里用「真实迁移产物」建内存库,再执行与路由一致的 SELECT,
 * 任何列名/表名漂移都会立即抛错。新建表/改列名时若忘了同步
 * account.ts,这个测试会先红。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../db.js';
import { migrations } from '../migrations.js';

let testDb: DatabaseType;

beforeAll(async () => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  await runMigrations(testDb, migrations);

  // 最小用户行（只填 NOT NULL 列,其余走默认值）
  testDb
    .prepare(
      `INSERT INTO users (id, password_hash, master_salt, recovery_hash, recovery_salt, wrapped_master_key, kdf_params)
       VALUES ('u1', x'00', x'00', x'00', x'00', '{}', '{"alg":"pbkdf2"}')`
    )
    .run();
  testDb
    .prepare(
      `INSERT INTO notes (id, user_id, ciphertext, client_updated_at) VALUES ('n1', 'u1', 'x', '2026-01-01T00:00:00Z')`
    )
    .run();
  testDb
    .prepare(
      `INSERT INTO folders (id, user_id, name) VALUES ('f1', 'u1', '默认')`
    )
    .run();
  testDb
    .prepare(
      `INSERT INTO shares (id, note_id, user_id, token, ciphertext, wrapped_share_key)
       VALUES ('s1', 'n1', 'u1', 'tok', 'ct', 'wk')`
    )
    .run();
});

describe('GET /account/export — SELECT 与真实 schema 一致（H1 回归）', () => {
  it('notes 导出列全部存在于迁移产物 schema', () => {
    const rows = testDb
      .prepare(
        `SELECT id, user_id, ciphertext, key_version, is_pinned, is_favorite, deleted_at, version, folder_id, client_updated_at, server_updated_at FROM notes WHERE user_id = ?`
      )
      .all('u1');
    expect(rows).toHaveLength(1);
  });

  it('user/devices/note_versions/noteTags/folders/tags/preferences/shares/templates 导出列全部存在', () => {
    // 以下 SELECT 与 account.ts 的 export 查询列清单保持一致（镜像断言）
    expect(
      testDb
        .prepare(
          `SELECT id, pw_salt, rc_salt, wrapped_master_key, wrapped_master_key_pw, wrapped_master_key_rc, kdf_version, kdf_params, recovery_code_set, created_at, updated_at FROM users WHERE id = ?`
        )
        .all('u1')
    ).toHaveLength(1);
    expect(
      testDb
        .prepare(
          `SELECT id, user_id, name, platform, fingerprint, last_active_at, created_at FROM devices WHERE user_id = ?`
        )
        .all('u1')
    ).toHaveLength(0);
    expect(
      testDb
        .prepare(
          `SELECT id, note_id, ciphertext, key_version, note_version, client_updated_at, created_at FROM note_versions WHERE user_id = ?`
        )
        .all('u1')
    ).toHaveLength(0);
    expect(
      testDb
        .prepare(
          `SELECT nt.note_id, nt.tag_id FROM note_tags nt INNER JOIN notes n ON nt.note_id = n.id WHERE n.user_id = ?`
        )
        .all('u1')
    ).toHaveLength(0);
    expect(
      testDb
        .prepare(
          `SELECT id, user_id, name, parent_id, icon, sort_order, created_at FROM folders WHERE user_id = ?`
        )
        .all('u1')
    ).toHaveLength(1);
    expect(
      testDb
        .prepare(`SELECT id, user_id, name, color FROM tags WHERE user_id = ?`)
        .all('u1')
    ).toHaveLength(0);
    expect(
      testDb
        .prepare(
          `SELECT user_id, theme, mode, font, density, auto_lock, language, updated_at FROM preferences WHERE user_id = ?`
        )
        .all('u1')
    ).toHaveLength(0);
    expect(
      testDb
        .prepare(
          `SELECT id, note_id, token, ciphertext, wrapped_share_key, password_hash IS NOT NULL AS has_password, expires_at, view_count, revoked, created_at FROM shares WHERE user_id = ?`
        )
        .all('u1')
    ).toHaveLength(1);
    expect(
      testDb
        .prepare(
          `SELECT id, user_id, name, description, category, icon, content, is_preset, sort_order, created_at, updated_at FROM templates WHERE user_id = ?`
        )
        .all('u1')
    ).toHaveLength(0);
  });
});
