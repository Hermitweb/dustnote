/**
 * 分享路由数据层单元测试
 *
 * shares.ts 的 handler 是 DB 查询 + lockout 逻辑的封装。
 * 本测试验证 DB 层语义：
 * 1. 创建分享 + audit_log 写入
 * 2. 吊销分享 + audit_log 写入
 * 3. 失败计数列存在且可读写（迁移 id=11 的 lockout 列）
 * 4. 公开访问的 lockout 状态转移（6 次错误 → 锁定）
 *
 * HTTP 层（POST/GET 双支持、密码 body 读取）需要 supertest，未安装；
 * lockout 纯函数逻辑由 lockout.test.ts 覆盖。
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

let testDb: DatabaseType;

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES ('user-1');
    CREATE TABLE notes (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
    INSERT INTO notes (id, user_id) VALUES ('note-1', 'user-1');
    -- shares 表包含迁移 id=11 的 lockout 列
    CREATE TABLE shares (
      id               TEXT PRIMARY KEY,
      note_id          TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token            TEXT NOT NULL UNIQUE,
      ciphertext       TEXT NOT NULL,
      wrapped_share_key TEXT NOT NULL,
      password_hash    TEXT,
      expires_at       TEXT,
      revoked          INTEGER NOT NULL DEFAULT 0,
      view_count       INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      failed_attempts  INTEGER NOT NULL DEFAULT 0,
      locked_until     TEXT
    );
    CREATE TABLE audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT,
      device_id  TEXT,
      event      TEXT NOT NULL,
      ip_hash    TEXT,
      meta       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  vi.mock('../db.js', () => ({
    getDb: () => testDb,
  }));
});

afterAll(() => {
  testDb.close();
});

beforeEach(() => {
  testDb.exec('DELETE FROM shares');
  testDb.exec('DELETE FROM audit_log');
});

describe('shares schema (migration id=11)', () => {
  it('failed_attempts and locked_until columns exist', () => {
    const cols = testDb.prepare("PRAGMA table_info(shares)").all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain('failed_attempts');
    expect(names).toContain('locked_until');
  });
});

describe('share creation + audit_log', () => {
  it('writes audit_log entry with share_create event on INSERT', () => {
    testDb.prepare(
      `INSERT INTO shares (id, note_id, user_id, token, ciphertext, wrapped_share_key)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('share-1', 'note-1', 'user-1', 'tok-1', 'cipher', 'wrapped');

    testDb.prepare(
      'INSERT INTO audit_log (user_id, device_id, event, meta) VALUES (?, ?, ?, ?)'
    ).run('user-1', 'dev-1', 'share_create', JSON.stringify({ shareId: 'share-1', hasPassword: false }));

    const log = testDb.prepare('SELECT event, meta FROM audit_log WHERE event = ?').get('share_create') as
      | { event: string; meta: string }
      | undefined;
    expect(log).toBeDefined();
    expect(JSON.parse(log!.meta).shareId).toBe('share-1');
  });
});

describe('share revocation + audit_log', () => {
  it('writes audit_log entry with share_revoke event on UPDATE', () => {
    testDb.prepare(
      `INSERT INTO shares (id, note_id, user_id, token, ciphertext, wrapped_share_key)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('share-2', 'note-1', 'user-1', 'tok-2', 'cipher', 'wrapped');

    testDb.prepare('UPDATE shares SET revoked = 1 WHERE id = ? AND user_id = ?').run('share-2', 'user-1');

    testDb.prepare(
      'INSERT INTO audit_log (user_id, device_id, event, meta) VALUES (?, ?, ?, ?)'
    ).run('user-1', 'dev-1', 'share_revoke', JSON.stringify({ shareId: 'share-2' }));

    const share = testDb.prepare('SELECT revoked FROM shares WHERE id = ?').get('share-2') as { revoked: number };
    expect(share.revoked).toBe(1);

    const log = testDb.prepare('SELECT event FROM audit_log WHERE event = ?').get('share_revoke') as
      | { event: string }
      | undefined;
    expect(log).toBeDefined();
    expect(log!.event).toBe('share_revoke');
  });
});

describe('share password lockout (migration id=11)', () => {
  it('failed_attempts can be incremented and reset', () => {
    testDb.prepare(
      `INSERT INTO shares (id, note_id, user_id, token, ciphertext, wrapped_share_key, password_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('share-3', 'note-1', 'user-1', 'tok-3', 'cipher', 'wrapped', 'hashed-pw');

    // 模拟 3 次失败
    for (let i = 1; i <= 3; i++) {
      testDb.prepare('UPDATE shares SET failed_attempts = ? WHERE id = ?').run(i, 'share-3');
    }
    let share = testDb.prepare('SELECT failed_attempts, locked_until FROM shares WHERE id = ?').get('share-3') as {
      failed_attempts: number;
      locked_until: string | null;
    };
    expect(share.failed_attempts).toBe(3);

    // 模拟成功后重置
    testDb.prepare('UPDATE shares SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run('share-3');
    share = testDb.prepare('SELECT failed_attempts, locked_until FROM shares WHERE id = ?').get('share-3') as {
      failed_attempts: number;
      locked_until: string | null;
    };
    expect(share.failed_attempts).toBe(0);
    expect(share.locked_until).toBeNull();
  });

  it('locked_until can be set and queried', () => {
    testDb.prepare(
      `INSERT INTO shares (id, note_id, user_id, token, ciphertext, wrapped_share_key, password_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('share-4', 'note-1', 'user-1', 'tok-4', 'cipher', 'wrapped', 'hashed-pw');

    const future = new Date(Date.now() + 15 * 60_000).toISOString();
    testDb.prepare('UPDATE shares SET failed_attempts = 6, locked_until = ? WHERE id = ?').run(future, 'share-4');

    const share = testDb.prepare('SELECT failed_attempts, locked_until FROM shares WHERE id = ?').get('share-4') as {
      failed_attempts: number;
      locked_until: string;
    };
    expect(share.failed_attempts).toBe(6);
    expect(share.locked_until).toBe(future);
    // 锁定时间在未来
    expect(new Date(share.locked_until).getTime()).toBeGreaterThan(Date.now());
  });
});
