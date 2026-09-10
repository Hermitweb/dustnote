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
import { purgeExpiredTrash, pruneAuditLog, TRASH_RETENTION_DAYS, SHARE_RETENTION_DAYS } from './trash-cleanup.js';

// 临时 DB 实例（:memory: 避免文件清理）
let testDb: DatabaseType;

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  // 最小 schema：notes/shares/audit_log + 一个 user 外键占位。
  // 此前最小 schema 没有 shares 表——「失效分享清理」分支从未被测试触达,
  // 审计 H2（清理从未生效）正是从这个盲区漏掉的。
  testDb
    .prepare(`CREATE TABLE users (id TEXT PRIMARY KEY)`)
    .run();
  testDb.prepare(`INSERT INTO users (id) VALUES (?)`).run('user-1');
  testDb
    .prepare(
      `CREATE TABLE notes (
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
      )`
    )
    .run();
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
  testDb
    .prepare(
      `CREATE TABLE audit_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    TEXT,
        device_id  TEXT,
        event      TEXT NOT NULL,
        ip_hash    TEXT,
        meta       TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();

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

function insertShare(
  id: string,
  opts: { revoked?: number; expiresAt?: string | null; createdAt?: string }
): void {
  // shares.note_id 外键需要真实笔记行,先补一条宿主笔记
  testDb
    .prepare(
      `INSERT OR IGNORE INTO notes (id, user_id, ciphertext, client_updated_at) VALUES (?, 'user-1', ?, '2026-01-01T00:00:00Z')`
    )
    .run(`share-note-${id}`, Buffer.from('x'));
  testDb
    .prepare(
      `INSERT INTO shares (id, note_id, user_id, token, ciphertext, wrapped_share_key, expires_at, revoked, created_at)
       VALUES (?, ?, 'user-1', ?, 'ct', 'wk', ?, ?, ?)`
    )
    .run(
      id,
      `share-note-${id}`,
      `token-${id}`,
      opts.expiresAt ?? null,
      opts.revoked ?? 0,
      opts.createdAt ?? '2026-01-01T00:00:00Z'
    );
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
    const cutoff = new Date(
      now.getTime() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
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

  it('SHARE_RETENTION_DAYS is 30', () => {
    expect(SHARE_RETENTION_DAYS).toBe(30);
  });

  it('deletes shares expired more than 30 days ago (H2 回归)', () => {
    const now = new Date('2026-03-01T00:00:00Z');
    testDb.exec('DELETE FROM shares');
    // 过期超 30 天 → 行被删
    insertShare('expired-old', { expiresAt: '2026-01-01T00:00:00Z' });
    // 过期但未满 30 天 → 保留
    insertShare('expired-recent', { expiresAt: '2026-02-15T00:00:00Z' });
    // 未过期 → 保留
    insertShare('active-share', { expiresAt: '2026-12-31T00:00:00Z' });

    purgeExpiredTrash(now);

    expect(testDb.prepare('SELECT 1 FROM shares WHERE id = ?').get('expired-old')).toBeUndefined();
    expect(testDb.prepare('SELECT 1 FROM shares WHERE id = ?').get('expired-recent')).toBeDefined();
    expect(testDb.prepare('SELECT 1 FROM shares WHERE id = ?').get('active-share')).toBeDefined();
  });

  it('keeps freshly revoked shares for the retention window, deletes old revoked rows', () => {
    const now = new Date('2026-03-01T00:00:00Z');
    testDb.exec('DELETE FROM shares');
    // 刚创建即吊销（created_at 在 30 天窗口内）→ 保留
    insertShare('revoked-fresh', { revoked: 1, createdAt: '2026-02-20T00:00:00Z' });
    // 吊销且创建超 30 天 → 行被删
    insertShare('revoked-old', { revoked: 1, createdAt: '2026-01-01T00:00:00Z' });

    purgeExpiredTrash(now);

    expect(testDb.prepare('SELECT 1 FROM shares WHERE id = ?').get('revoked-fresh')).toBeDefined();
    expect(testDb.prepare('SELECT 1 FROM shares WHERE id = ?').get('revoked-old')).toBeUndefined();
  });
});

describe('pruneAuditLog', () => {
  it('deletes audit rows older than 180 days and keeps recent ones', () => {
    const now = new Date('2026-03-01T00:00:00Z');
    testDb.exec('DELETE FROM audit_log');
    const oldTs = '2025-06-01T00:00:00Z'; // ~9 个月前
    const recentTs = '2026-02-01T00:00:00Z';
    testDb
      .prepare('INSERT INTO audit_log (user_id, event, created_at) VALUES (?, ?, ?)')
      .run('user-1', 'login_failed', oldTs);
    testDb
      .prepare('INSERT INTO audit_log (user_id, event, created_at) VALUES (?, ?, ?)')
      .run('user-1', 'login_success', recentTs);

    const pruned = pruneAuditLog(now);

    expect(pruned).toBe(1);
    expect(testDb.prepare('SELECT COUNT(*) AS c FROM audit_log').get()).toMatchObject({ c: 1 });
  });
});
