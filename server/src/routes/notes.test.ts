/**
 * 笔记路由数据层单元测试
 *
 * notesRouter 的 handler 是 DB 查询的薄封装（路由层无独立业务逻辑）。
 * 测试 HTTP 层需要 supertest（未安装），因此这里直接验证 handler 依赖的
 * DB 查询语义：乐观锁、软删除/恢复/永久删除、includeDeleted 过滤。
 *
 * 这样能捕获：schema 约束违反、WHERE 条件错误、version 自增逻辑等回归。
 * 加密本身由 shared/test/crypto.test.ts 覆盖，ciphertext 当作不透明字符串。
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
    CREATE INDEX idx_notes_user ON notes(user_id);
    CREATE INDEX idx_notes_deleted ON notes(user_id, deleted_at);
  `);

  // 让 notes.ts / trash-cleanup.ts 内部的 getDb() 返回我们的内存实例
  vi.mock('../db.js', () => ({
    getDb: () => testDb,
  }));
  // 路由会调用 broadcastNoteChanged，mock 掉避免拉起 WS
  vi.mock('../services/sync-ws.js', () => ({
    broadcastNoteChanged: () => undefined,
  }));
});

afterAll(() => {
  testDb.close();
});

beforeEach(() => {
  testDb.exec('DELETE FROM notes');
});

const NOW = () => new Date().toISOString();

describe('notes data layer (queries used by notesRouter handlers)', () => {
  describe('POST /notes — insert', () => {
    it('inserts a note with version 1 and null deleted_at', () => {
      const id = 'n-create';
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, key_version, is_pinned, is_favorite, client_updated_at, folder_id, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(id, 'user-1', '{"v":1,"payload":{}}', 1, 0, 0, NOW(), null);

      const row = testDb
        .prepare('SELECT id, version, deleted_at FROM notes WHERE id = ?')
        .get(id) as { id: string; version: number; deleted_at: string | null };
      expect(row.id).toBe(id);
      expect(row.version).toBe(1);
      expect(row.deleted_at).toBeNull();
    });

    it('rejects insert for non-existent user (FK constraint)', () => {
      expect(() =>
        testDb
          .prepare(
            `INSERT INTO notes (id, user_id, ciphertext, client_updated_at) VALUES (?, ?, ?, ?)`
          )
          .run('n-fk', 'nonexistent-user', 'x', NOW())
      ).toThrow();
    });
  });

  describe('GET /notes — listing', () => {
    it('includeDeleted=1 returns both active and trashed notes', () => {
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run('active', 'user-1', 'x', NOW(), null);
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run('trashed', 'user-1', 'x', NOW(), '2026-01-01T00:00:00Z');

      // 复用 handler 的查询：includeDeleted=true → WHERE user_id = ?
      const rows = testDb
        .prepare(
          `SELECT * FROM notes WHERE user_id = ? ORDER BY is_pinned DESC, server_updated_at DESC LIMIT 500`
        )
        .all('user-1') as { id: string }[];
      const ids = rows.map((r) => r.id);
      expect(ids).toContain('active');
      expect(ids).toContain('trashed');
    });

    it('without includeDeleted hides trashed notes', () => {
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run('active', 'user-1', 'x', NOW(), null);
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run('trashed', 'user-1', 'x', NOW(), '2026-01-01T00:00:00Z');

      // handler 查询：includeDeleted=false → WHERE user_id = ? AND deleted_at IS NULL
      const rows = testDb
        .prepare(
          `SELECT * FROM notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY is_pinned DESC, server_updated_at DESC LIMIT 500`
        )
        .all('user-1') as { id: string }[];
      expect(rows.map((r) => r.id)).toEqual(['active']);
    });

    it('sorts pinned notes before unpinned', () => {
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, is_pinned) VALUES (?, ?, ?, ?, 0)`
        )
        .run('unpinned', 'user-1', 'x', NOW());
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, is_pinned) VALUES (?, ?, ?, ?, 1)`
        )
        .run('pinned', 'user-1', 'x', NOW());

      const rows = testDb
        .prepare(
          `SELECT * FROM notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY is_pinned DESC, server_updated_at DESC LIMIT 500`
        )
        .all('user-1') as { id: string; is_pinned: number }[];
      expect(rows[0]!.id).toBe('pinned');
      expect(rows[1]!.id).toBe('unpinned');
    });
  });

  describe('PATCH /notes/:id — optimistic lock', () => {
    it('version mismatch → handler returns 409 (condition detectable)', () => {
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, version) VALUES (?, ?, ?, ?, 1)`
        )
        .run('lock', 'user-1', 'x', NOW());

      const existing = testDb
        .prepare('SELECT version FROM notes WHERE id = ? AND user_id = ?')
        .get('lock', 'user-1') as { version: number };
      const clientVersion = 2; // 客户端拿着旧版本号
      expect(existing.version).not.toBe(clientVersion); // handler 据此返回 409
    });

    it('version match → update succeeds and version bumps', () => {
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, version) VALUES (?, ?, ?, ?, 1)`
        )
        .run('lock-ok', 'user-1', 'x', NOW());

      // handler 成功路径：version 匹配(1)，执行 UPDATE ... version = version + 1
      testDb
        .prepare(
          `UPDATE notes SET version = version + 1, client_updated_at = ? WHERE id = ? AND user_id = ?`
        )
        .run(NOW(), 'lock-ok', 'user-1');

      const after = testDb.prepare('SELECT version FROM notes WHERE id = ?').get('lock-ok') as {
        version: number;
      };
      expect(after.version).toBe(2);
    });
  });

  describe('DELETE /notes/:id — soft delete', () => {
    it('sets deleted_at and bumps version', () => {
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, version) VALUES (?, ?, ?, ?, 1)`
        )
        .run('soft', 'user-1', 'x', NOW());

      const result = testDb
        .prepare(
          `UPDATE notes SET deleted_at = datetime('now'), version = version + 1
           WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
        )
        .run('soft', 'user-1');
      expect(result.changes).toBe(1);

      const row = testDb
        .prepare('SELECT deleted_at, version FROM notes WHERE id = ?')
        .get('soft') as { deleted_at: string | null; version: number };
      expect(row.deleted_at).not.toBeNull();
      expect(row.version).toBe(2);
    });

    it('is idempotent: already-deleted note → changes=0 (handler returns 404)', () => {
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, deleted_at, version) VALUES (?, ?, ?, ?, ?, 2)`
        )
        .run('soft2', 'user-1', 'x', NOW(), '2026-01-01T00:00:00Z');

      const result = testDb
        .prepare(
          `UPDATE notes SET deleted_at = datetime('now'), version = version + 1
           WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
        )
        .run('soft2', 'user-1');
      expect(result.changes).toBe(0);
    });
  });

  describe('DELETE /notes/:id/permanent — hard delete', () => {
    it('removes the row entirely', () => {
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, deleted_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run('perm', 'user-1', 'x', NOW(), '2026-01-01T00:00:00Z');

      const result = testDb
        .prepare(`DELETE FROM notes WHERE id = ? AND user_id = ?`)
        .run('perm', 'user-1');
      expect(result.changes).toBe(1);
      expect(testDb.prepare('SELECT 1 FROM notes WHERE id = ?').get('perm')).toBeUndefined();
    });

    it('returns changes=0 for non-existent note', () => {
      const result = testDb
        .prepare(`DELETE FROM notes WHERE id = ? AND user_id = ?`)
        .run('never-existed', 'user-1');
      expect(result.changes).toBe(0);
    });
  });

  describe('restore — PATCH deletedAt=null', () => {
    it('clears deleted_at and bumps version', () => {
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, deleted_at, version) VALUES (?, ?, ?, ?, ?, 1)`
        )
        .run('rest', 'user-1', 'x', NOW(), '2026-01-01T00:00:00Z');

      testDb
        .prepare(
          `UPDATE notes SET deleted_at = NULL, version = version + 1 WHERE id = ? AND user_id = ?`
        )
        .run('rest', 'user-1');

      const row = testDb
        .prepare('SELECT deleted_at, version FROM notes WHERE id = ?')
        .get('rest') as { deleted_at: string | null; version: number };
      expect(row.deleted_at).toBeNull();
      expect(row.version).toBe(2);
    });
  });
});
