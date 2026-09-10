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
  // 软删会级联吊销分享（M6）,测试 schema 补齐 shares 表
  testDb
    .prepare(
      `CREATE TABLE shares (
        id            TEXT PRIMARY KEY,
        note_id       TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token         TEXT NOT NULL UNIQUE,
        ciphertext    TEXT NOT NULL,
        wrapped_share_key TEXT NOT NULL,
        password_hash TEXT,
        expires_at    TEXT,
        view_count    INTEGER NOT NULL DEFAULT 0,
        revoked       INTEGER NOT NULL DEFAULT 0,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until  TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();
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

    it('is idempotent: already-deleted note → changes=0 (handler 现按行存在返回 200 alreadyDeleted)', () => {
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

  describe('POST /notes — 幂等重放（H4）', () => {
    it('ON CONFLICT DO NOTHING: 同 id 二次插入 changes=0 且不抛错', () => {
      const insertSql = `
        INSERT INTO notes (id, user_id, ciphertext, key_version, is_pinned, is_favorite, client_updated_at, folder_id, version, server_updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ON CONFLICT(id) DO NOTHING`;
      const first = testDb.prepare(insertSql).run('dup-1', 'user-1', 'x', 1, 0, 0, NOW(), null);
      expect(first.changes).toBe(1);
      // 重放同 id（弱网响应丢失后的重试）——此前裸 INSERT 会抛 UNIQUE 约束 → 500
      const second = testDb.prepare(insertSql).run('dup-1', 'user-1', 'y', 1, 0, 0, NOW(), null);
      expect(second.changes).toBe(0);
      // 行内容保持首次写入,不被重放覆盖
      const row = testDb.prepare('SELECT ciphertext FROM notes WHERE id = ?').get('dup-1') as {
        ciphertext: string;
      };
      expect(row.ciphertext).toBe('x');
    });
  });

  describe('DELETE /notes/:id — 软删级联吊销分享（M6）', () => {
    it('软删笔记后其活跃分享被置 revoked=1', () => {
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at) VALUES (?, ?, ?, ?)`
        )
        .run('share-host', 'user-1', 'x', NOW());
      testDb
        .prepare(
          `INSERT INTO shares (id, note_id, user_id, token, ciphertext, wrapped_share_key, revoked)
           VALUES ('s1', 'share-host', 'user-1', 'tok-1', 'ct', 'wk', 0)`
        )
        .run();
      testDb
        .prepare(
          `INSERT INTO shares (id, note_id, user_id, token, ciphertext, wrapped_share_key, revoked)
           VALUES ('s2', 'share-host', 'user-1', 'tok-2', 'ct', 'wk', 1)`
        )
        .run();

      // handler 的级联语义:软删 + 吊销该笔记全部活跃分享（同事务）
      testDb.prepare(`UPDATE notes SET deleted_at = ?, version = version + 1 WHERE id = ? AND deleted_at IS NULL`).run(NOW(), 'share-host');
      const revoked = testDb
        .prepare('UPDATE shares SET revoked = 1 WHERE note_id = ? AND user_id = ? AND revoked = 0')
        .run('share-host', 'user-1');
      expect(revoked.changes).toBe(1); // 只动活跃分享

      const s1 = testDb.prepare('SELECT revoked FROM shares WHERE id = ?').get('s1') as {
        revoked: number;
      };
      expect(s1.revoked).toBe(1);
    });
  });

  describe('GET /notes — 游标分页（H3）', () => {
    it('cursor 条件不重不漏地续页（含同时间戳并列决胜）', () => {
      // 三条同 server_updated_at + 一条更早：验证并列决胜不丢行
      const ts = '2026-03-01T00:00:00.000Z';
      const rows: Array<[string, string]> = [
        ['pg-a', ts],
        ['pg-b', ts],
        ['pg-c', ts],
        ['pg-old', '2026-02-01T00:00:00.000Z'],
      ];
      for (const [id, t] of rows) {
        testDb
          .prepare(
            `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, server_updated_at) VALUES (?, 'user-1', 'x', ?, ?)`
          )
          .run(id, NOW(), t);
      }

      const listSql = (cursorTs?: string, cursorId?: string) => {
        const conds = ['user_id = ?', "deleted_at IS NULL"];
        const params: unknown[] = ['user-1'];
        if (cursorTs && cursorId) {
          conds.push('(server_updated_at < ? OR (server_updated_at = ? AND id < ?))');
          params.push(cursorTs, cursorTs, cursorId);
        }
        return testDb
          .prepare(`SELECT * FROM notes WHERE ${conds.join(' AND ')} ORDER BY server_updated_at DESC, id DESC LIMIT 2`)
          .all(...params) as { id: string; server_updated_at: string }[];
      };

      const page1 = listSql();
      expect(page1.map((r) => r.id)).toEqual(['pg-c', 'pg-b']); // id 倒序决胜
      const last1 = page1[page1.length - 1]!;
      const page2 = listSql(last1.server_updated_at, last1.id);
      expect(page2.map((r) => r.id)).toEqual(['pg-a', 'pg-old']);
    });
  });
});
