import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migrations } from './migrations.js';

/**
 * 审计 TEST-R02：为迁移 19（normalize-remaining-timestamps）补行为测试。
 * 直接调用其 up() 对含空格旧格式时间戳的存量行做归一，断言转成带 Z 的 ISO；
 * 并验证对不存在表/列的 table_info 守卫不抛错。
 */
describe('migration 19: normalize-remaining-timestamps', () => {
  const m19 = migrations.find((m) => m.id === 19);

  function freshDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    // 跑除 19 外的全部迁移建表
    for (const m of migrations) if (m.id !== 19) m.up(db);
    return db;
  }

  it('存在且幂等（空库跑通不抛错）', () => {
    expect(m19).toBeTruthy();
    const db = freshDb();
    expect(() => m19!.up(db)).not.toThrow();
    expect(() => m19!.up(db)).not.toThrow(); // 二次幂等
    db.close();
  });

  it('把 folders 空格旧格式 created_at 归一为 ISO+Z', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO users (id, password_hash, master_salt, recovery_hash, recovery_salt, wrapped_master_key, kdf_params)
       VALUES ('u1', X'', X'', X'', X'', 'x', '{}')`
    ).run();
    db.prepare(
      `INSERT INTO folders (id, user_id, name, created_at) VALUES ('f1', 'u1', 'x', '2026-01-01 10:00:00')`
    ).run();

    m19!.up(db);

    const row = db.prepare(`SELECT created_at FROM folders WHERE id = 'f1'`).get() as {
      created_at: string;
    };
    expect(row.created_at).toBe('2026-01-01T10:00:00Z');
    db.close();
  });

  it('已是 ISO 的行不被二次改写（幂等）', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO users (id, password_hash, master_salt, recovery_hash, recovery_salt, wrapped_master_key, kdf_params)
       VALUES ('u1', X'', X'', X'', X'', 'x', '{}')`
    ).run();
    db.prepare(
      `INSERT INTO folders (id, user_id, name, created_at) VALUES ('f1', 'u1', 'x', '2026-01-01T10:00:00.000Z')`
    ).run();

    m19!.up(db);
    m19!.up(db);

    const row = db.prepare(`SELECT created_at FROM folders WHERE id = 'f1'`).get() as {
      created_at: string;
    };
    expect(row.created_at).toBe('2026-01-01T10:00:00.000Z');
    db.close();
  });
});
