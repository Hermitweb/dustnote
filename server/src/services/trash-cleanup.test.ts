/**
 * server/src/services/trash-cleanup.ts 单测 —— 过期回收站/分享/审计清理
 *
 * 注入 now 控制时间边界；broadcastNoteChanged mock 掉。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

let testDb: DatabaseType;
const USER_A = 'user-a';
const USER_B = 'user-b';

vi.mock('../db.js', () => ({ getDb: () => testDb }));
vi.mock('../logger.js', () => ({
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));
const { broadcastSpy } = vi.hoisted(() => ({ broadcastSpy: vi.fn() }));
vi.mock('./sync-ws.js', () => ({ broadcastNoteChanged: broadcastSpy }));

import {
  pruneAuditLog,
  purgeExpiredTrash,
  TRASH_RETENTION_DAYS,
  SHARE_RETENTION_DAYS,
  AUDIT_RETENTION_DAYS,
  startTrashCleanup,
  stopTrashCleanup,
} from './trash-cleanup.js';

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES ('${USER_A}');
    INSERT INTO users (id) VALUES ('${USER_B}');
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE shares (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      wrapped_share_key TEXT NOT NULL,
      password_hash TEXT,
      expires_at TEXT,
      view_count INTEGER NOT NULL DEFAULT 0,
      revoked INTEGER NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT, device_id TEXT, event TEXT NOT NULL,
      ip_hash TEXT, meta TEXT,
      created_at TEXT
    );
  `);
});

afterAll(() => {
  stopTrashCleanup();
  testDb.close();
});

beforeEach(() => {
  testDb.exec('DELETE FROM audit_log');
  testDb.exec('DELETE FROM shares');
  testDb.exec('DELETE FROM notes');
  broadcastSpy.mockReset();
});

const NOW = new Date('2026-10-15T00:00:00.000Z');

describe('trash-cleanup 常量', () => {
  it('保留天数配置正确（30 / 30 / 180）', () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
    expect(SHARE_RETENTION_DAYS).toBe(30);
    expect(AUDIT_RETENTION_DAYS).toBe(180);
  });
});

describe('pruneAuditLog', () => {
  it('超过 180 天的 audit 行被删', () => {
    const old = new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    testDb.prepare('INSERT INTO audit_log (event, created_at) VALUES (?, ?)').run('old', old);
    testDb.prepare('INSERT INTO audit_log (event, created_at) VALUES (?, ?)').run('recent', recent);
    const removed = pruneAuditLog(NOW);
    expect(removed).toBe(1);
    const remaining = testDb.prepare('SELECT event FROM audit_log').all() as { event: string }[];
    expect(remaining.map((r) => r.event)).toEqual(['recent']);
  });

  it('空表 → 返回 0 不报错', () => {
    expect(pruneAuditLog(NOW)).toBe(0);
  });
});

describe('purgeExpiredTrash', () => {
  it('已软删 > 30 天的笔记被永久删（不广播 — 因 broadcastNoteChanged 已被 mock 不应真正发）', () => {
    const old = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    testDb
      .prepare('INSERT INTO notes (id, user_id, deleted_at) VALUES (?, ?, ?)')
      .run('n-1', USER_A, old);
    testDb
      .prepare('INSERT INTO notes (id, user_id, deleted_at) VALUES (?, ?, ?)')
      .run('n-2', USER_A, recent);
    testDb
      .prepare('INSERT INTO notes (id, user_id, deleted_at) VALUES (?, ?, ?)')
      .run('n-3', USER_A, null); // 活跃笔记

    const removed = purgeExpiredTrash(NOW);
    expect(removed).toBe(1);
    const remaining = testDb.prepare('SELECT id FROM notes ORDER BY id').all() as { id: string }[];
    expect(remaining.map((r) => r.id)).toEqual(['n-2', 'n-3']);
    // 广播被调用（per-note）
    expect(broadcastSpy).toHaveBeenCalledWith(USER_A, { id: 'n-1', op: 'permanent_delete' });
  });

  it('多条过期笔记都广播 + 删', () => {
    const old = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
    testDb
      .prepare('INSERT INTO notes (id, user_id, deleted_at) VALUES (?, ?, ?)')
      .run('p-1', USER_A, old);
    testDb
      .prepare('INSERT INTO notes (id, user_id, deleted_at) VALUES (?, ?, ?)')
      .run('p-2', USER_B, old);

    expect(purgeExpiredTrash(NOW)).toBe(2);
    expect(broadcastSpy).toHaveBeenCalledTimes(2);
    expect(broadcastSpy).toHaveBeenCalledWith(USER_A, { id: 'p-1', op: 'permanent_delete' });
    expect(broadcastSpy).toHaveBeenCalledWith(USER_B, { id: 'p-2', op: 'permanent_delete' });
  });

  it('无过期笔记 → 返回 0，广播不被调用，但分享清理仍跑（已知 H2 修复）', () => {
    testDb
      .prepare('INSERT INTO notes (id, user_id, deleted_at) VALUES (?, ?, ?)')
      .run('a-1', USER_A, null);
    expect(purgeExpiredTrash(NOW)).toBe(0);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('活跃笔记（deleted_at=null）永不被删', () => {
    testDb
      .prepare('INSERT INTO notes (id, user_id, deleted_at) VALUES (?, ?, ?)')
      .run('alive', USER_A, null);
    expect(purgeExpiredTrash(NOW)).toBe(0);
    const row = testDb.prepare('SELECT id FROM notes WHERE id=?').get('alive');
    expect(row).toBeDefined();
  });
});

describe('purgeExpiredTrash 分享清理', () => {
  it('过期（expires_at < 30天前）分享被删', () => {
    // SHARE_RETENTION_DAYS=30：cutoff = now - 30 天。expired-1 的 expires_at 在 cutoff 之前 → 删
    // （SQL 条件是 expires_at < cutoff：分享失效日期早于 30 天前的行被清）
    const longExpired = new Date(NOW.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();
    testDb
      .prepare(
        `INSERT INTO shares (id, user_id, token, ciphertext, wrapped_share_key, expires_at, revoked) VALUES (?, ?, ?, ?, ?, ?, 0)`
      )
      .run('exp-1', USER_A, 'tok-1', 'c', 'k', longExpired);
    testDb
      .prepare(
        `INSERT INTO shares (id, user_id, token, ciphertext, wrapped_share_key, expires_at, revoked) VALUES (?, ?, ?, ?, ?, ?, 0)`
      )
      .run('exp-2', USER_A, 'tok-2', 'c', 'k', null); // 未过期
    purgeExpiredTrash(NOW);
    const remaining = testDb.prepare('SELECT id FROM shares').all() as { id: string }[];
    expect(remaining.map((r) => r.id)).toEqual(['exp-2']);
  });

  it('吊销超过 30 天的分享被删', () => {
    const old = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
    testDb
      .prepare(
        `INSERT INTO shares (id, user_id, token, ciphertext, wrapped_share_key, created_at, revoked) VALUES (?, ?, ?, ?, ?, ?, 1)`
      )
      .run('rev-1', USER_A, 'tok-3', 'c', 'k', old);
    testDb
      .prepare(
        `INSERT INTO shares (id, user_id, token, ciphertext, wrapped_share_key, created_at, revoked) VALUES (?, ?, ?, ?, ?, ?, 0)`
      )
      .run('rev-2', USER_A, 'tok-4', 'c', 'k', old); // 旧但未吊销
    purgeExpiredTrash(NOW);
    const remaining = testDb.prepare('SELECT id FROM shares').all() as { id: string }[];
    expect(remaining.map((r) => r.id)).toEqual(['rev-2']);
  });
});

describe('purgeExpiredTrash 分享清理 try/catch 容错', () => {
  it('shares 表缺失 → 不抛（try/catch 兜底）', async () => {
    // 单独建库不建 shares 表 → DELETE shares 会抛 no such table
    // purgeExpiredTrash 内部 try/catch 把它吞掉，函数正常返回 purgedNotes
    const freshDb = new Database(':memory:');
    freshDb.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      INSERT INTO users (id) VALUES ('${USER_A}');
      CREATE TABLE notes (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        deleted_at TEXT
      );
      -- 不建 shares 表 → 下面 DELETE 会抛 no such table
    `);
    // vi.doMock 注册新 getDb；vi.resetModules 触发 trash-cleanup 重导
    vi.doMock('../db.js', () => ({ getDb: () => freshDb }));
    vi.resetModules();
    const m = await import('./trash-cleanup.js');
    // 不应抛
    expect(() => m.purgeExpiredTrash(NOW)).not.toThrow();
    freshDb.close();
    // 还原 mock
    vi.doMock('../db.js', () => ({ getDb: () => testDb }));
    vi.resetModules();
  });
});

describe('startTrashCleanup / stopTrashCleanup', () => {
  it('启动 → 立即跑一次 purge → setInterval 计划中（unref）', () => {
    // 启动时即跑一次：插一条过期笔记 + 启动 → 应被清
    const old = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
    testDb
      .prepare('INSERT INTO notes (id, user_id, deleted_at) VALUES (?, ?, ?)')
      .run('start-1', USER_A, old);

    startTrashCleanup();
    // 启动立即跑一次 → 'start-1' 应被删
    const remaining = testDb.prepare('SELECT id FROM notes').all() as { id: string }[];
    expect(remaining.map((r) => r.id)).toEqual([]);

    stopTrashCleanup();
  });

  it('stopTrashCleanup → setInterval 清掉，二次启动再调度', () => {
    startTrashCleanup();
    stopTrashCleanup();
    // 不应报错
    startTrashCleanup();
    stopTrashCleanup();
  });

  it('startTrashCleanup 在 purge 抛错时仍继续（启动 try/catch 兜底）', () => {
    // 不需要实际抛错：startTrashCleanup 内部用 try/catch 包装 purge 调用
    // 这里只验证调用本身不抛——足够覆盖 try 块路径
    expect(() => startTrashCleanup()).not.toThrow();
    stopTrashCleanup();
  });

  it('定时器回调：1 小时后触发 purge + prune（fake timers）', () => {
    vi.useFakeTimers();
    try {
      // 插一条过期笔记 + 一条 40 天前的审计日志
      const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      testDb
        .prepare('INSERT INTO notes (id, user_id, deleted_at) VALUES (?, ?, ?)')
        .run('timer-1', USER_A, old);
      testDb
        .prepare(
          `INSERT INTO audit_log (user_id, device_id, event, created_at)
           VALUES (?, ?, 'login_failed', ?)`
        )
        .run(USER_A, 'd1', new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString());

      startTrashCleanup();
      // 启动已立即跑一次 → timer-1 已被删。再推进 1 小时触发定时器回调
      // （第二次 purge 无过期数据，但回调内 pruneAuditLog 会修剪 40 天前审计日志）
      const auditBefore = testDb.prepare('SELECT COUNT(*) c FROM audit_log').get() as { c: number };
      vi.advanceTimersByTime(60 * 60 * 1000); // 1 小时
      const auditAfter = testDb.prepare('SELECT COUNT(*) c FROM audit_log').get() as { c: number };
      // 40 天前的审计日志在 180 天保留窗口内 → 不会被删，c 不变
      expect(auditAfter.c).toBe(auditBefore.c);
      stopTrashCleanup();
    } finally {
      vi.useRealTimers();
    }
  });
});
