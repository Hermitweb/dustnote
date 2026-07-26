/**
 * 回收站自动清理单元测试
 *
 * purgeExpiredTrash 依赖 getDb()（全局单例 DB）。
 * 测试用 Database 临时实例 + 直接 monkey-patch getDb 模块，
 * 避免污染开发库或依赖文件路径。
 *
 * 重点验证：30 天阈值边界、只删已软删且过期的笔记、保留未删除/未过期的。
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { purgeExpiredTrash, TRASH_RETENTION_DAYS } from './trash-cleanup.js';

// 临时 DB 实例（:memory: 避免文件清理）
let testDb: DatabaseType;

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  // 最小 schema：只需 notes 表的字段 + 一个 user 外键占位
  testDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES ('user-1');
    CREATE TABLE notes (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ciphertext      BLOB NOT NULL,
      nonce           BLOB,
      key_version     INTEGER NOT NULL DEFAULT 1,
      is_pinned       INTEGER NOT NULL DEFAULT 0,
      is_favorite     INTEGER NOT NULL DEFAULT 0,
      deleted_at      TEXT,
      version         INTEGER NOT NULL DEFAULT 1,
      client_updated_at TEXT NOT NULL,
      server_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      folder_id       TEXT
    );
  `);

  // 把 getDb 替换为返回我们的内存实例。
  // purgeExpiredTrash 内部调用 getDb()，所以只需 patch 模块导出。
  vi.mock('../db.js', () => ({
    getDb: () => testDb,
  }));
});

afterAll(() => {
  testDb.close();
});

function insertNote(id: string, deletedAt: string | null): void {
  testDb
    .prepare(
      `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, 'user-1', Buffer.from('x'), '2026-01-01T00:00:00Z', deletedAt);
}

describe('purgeExpiredTrash', () => {
  it('TRASH_RETENTION_DAYS is 30', () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
  });

  it('deletes notes soft-deleted more than 30 days ago', () => {
    // 固定 now 为 2026-03-01，31 天前删除 → 应被清理
    const now = new Date('2026-03-01T00:00:00Z');
    const oldDate = new Date(
      now.getTime() - (TRASH_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000
    ).toISOString();
    insertNote('old-deleted', oldDate);

    const purged = purgeExpiredTrash(now);
    expect(purged).toBeGreaterThanOrEqual(1);

    const remains = testDb.prepare('SELECT 1 FROM notes WHERE id = ?').get('old-deleted');
    expect(remains).toBeUndefined();
  });

  it('keeps notes soft-deleted less than 30 days ago', () => {
    const now = new Date('2026-03-01T00:00:00Z');
    const recentDate = new Date(
      now.getTime() - (TRASH_RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000
    ).toISOString();
    insertNote('recent-deleted', recentDate);

    const before = (
      testDb.prepare('SELECT COUNT(*) AS c FROM notes WHERE id = ?').get('recent-deleted') as {
        c: number;
      }
    ).c;
    expect(before).toBe(1);

    purgeExpiredTrash(now);

    const after = (
      testDb.prepare('SELECT COUNT(*) AS c FROM notes WHERE id = ?').get('recent-deleted') as {
        c: number;
      }
    ).c;
    expect(after).toBe(1);
  });

  it('keeps notes that are not deleted (deleted_at IS NULL)', () => {
    const now = new Date('2026-03-01T00:00:00Z');
    insertNote('active-note', null);

    purgeExpiredTrash(now);

    const after = (
      testDb.prepare('SELECT COUNT(*) AS c FROM notes WHERE id = ?').get('active-note') as {
        c: number;
      }
    ).c;
    expect(after).toBe(1);
  });

  it('boundary: exactly 30 days ago is kept (cutoff is exclusive)', () => {
    // cutoff = now - 30d. DELETE WHERE deleted_at < cutoff.
    // 笔记 deleted_at == cutoff（恰好 30 天）不应被删（< 严格小于）。
    const now = new Date('2026-03-01T00:00:00Z');
    const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    insertNote('boundary-note', cutoff);

    purgeExpiredTrash(now);

    const after = (
      testDb.prepare('SELECT COUNT(*) AS c FROM notes WHERE id = ?').get('boundary-note') as {
        c: number;
      }
    ).c;
    expect(after).toBe(1);
  });

  it('returns 0 when nothing to purge', () => {
    // 清空后重新插入一条未删除笔记
    testDb.exec('DELETE FROM notes');
    insertNote('only-active', null);
    const now = new Date('2026-03-01T00:00:00Z');
    expect(purgeExpiredTrash(now)).toBe(0);
  });
});
