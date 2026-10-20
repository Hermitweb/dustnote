/**
 * lockout 单元测试（核心安全模块）
 *
 * 覆盖：
 *  - isLocked / remainingLockMs 边界（null / 过期 / 未过期）
 *  - recordFailure 累计次数、达到 MAX_FAILED_ATTEMPTS 触发锁定
 *  - recordSuccess 返回 CLEAN_STATE
 *  - recordFailureAtomic：users / shares 表都支持；并发场景下 +1 原子生效
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  MAX_FAILED_ATTEMPTS,
  LOCK_DURATION_MS,
  CLEAN_STATE,
  isLocked,
  remainingLockMs,
  recordFailure,
  recordSuccess,
  recordFailureAtomic,
  type LockoutState,
} from './lockout.js';

describe('lockout / isLocked', () => {
  it('lockedUntil 为 null → 未锁定', () => {
    expect(isLocked({ failedAttempts: 0, lockedUntil: null })).toBe(false);
  });

  it('lockedUntil 未来时间 → 已锁定', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isLocked({ failedAttempts: 1, lockedUntil: future })).toBe(true);
  });

  it('lockedUntil 过去时间 → 未锁定', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isLocked({ failedAttempts: 1, lockedUntil: past })).toBe(false);
  });

  it('支持注入 now（测试时间）', () => {
    // lockedUntil 比 beforeNow 早 → 未锁定
    const past = new Date(Date.now() - 60_000).toISOString();
    const beforeNow = new Date(Date.now() - 30_000); // 30s 前,比 past 晚
    expect(isLocked({ failedAttempts: 1, lockedUntil: past }, beforeNow)).toBe(false);

    // lockedUntil 在 futureNow 之后 → 锁定中
    const future = new Date(Date.now() + 60_000).toISOString();
    const futureNow = new Date(Date.now() + 30_000); // 30s 后,比 future 早
    expect(isLocked({ failedAttempts: 1, lockedUntil: future }, futureNow)).toBe(true);
  });
});

describe('lockout / remainingLockMs', () => {
  it('未锁定 → 0', () => {
    expect(remainingLockMs({ failedAttempts: 0, lockedUntil: null })).toBe(0);
  });

  it('锁定中 → 返回剩余 ms', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const remain = remainingLockMs({ failedAttempts: 1, lockedUntil: future });
    expect(remain).toBeGreaterThan(59_000);
    expect(remain).toBeLessThanOrEqual(60_000);
  });

  it('锁定已过期 → 0（不会负数）', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(remainingLockMs({ failedAttempts: 1, lockedUntil: past })).toBe(0);
  });
});

describe('lockout / recordFailure', () => {
  it('失败次数累加，未触发锁定', () => {
    const now = new Date();
    const s = recordFailure({ failedAttempts: 0, lockedUntil: null }, now);
    expect(s.failedAttempts).toBe(1);
    expect(s.lockedUntil).toBeNull();
  });

  it('达到 MAX_FAILED_ATTEMPTS 触发锁定', () => {
    const now = new Date();
    const state: LockoutState = {
      failedAttempts: MAX_FAILED_ATTEMPTS - 1,
      lockedUntil: null,
    };
    const s = recordFailure(state, now);
    expect(s.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(s.lockedUntil).not.toBeNull();
    const until = new Date(s.lockedUntil!).getTime();
    expect(until).toBeGreaterThanOrEqual(now.getTime() + LOCK_DURATION_MS - 1000);
    expect(until).toBeLessThanOrEqual(now.getTime() + LOCK_DURATION_MS + 1000);
  });

  it('已锁定状态下失败：保持锁定，刷新 lockedUntil', () => {
    const now = new Date();
    const state: LockoutState = {
      failedAttempts: MAX_FAILED_ATTEMPTS,
      lockedUntil: new Date(now.getTime() + 1000).toISOString(),
    };
    const s = recordFailure(state, now);
    expect(s.failedAttempts).toBe(MAX_FAILED_ATTEMPTS + 1);
    expect(s.lockedUntil).not.toBeNull();
  });
});

describe('lockout / recordSuccess', () => {
  it('返回 CLEAN_STATE', () => {
    expect(recordSuccess()).toEqual(CLEAN_STATE);
  });
});

describe('lockout / recordFailureAtomic (DB 集成)', () => {
  it('users 表：原子 +1，达阈值自动置锁', () => {
    const db = new Database(':memory:');
    db.exec(
      `CREATE TABLE users (id TEXT PRIMARY KEY, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT)`
    );
    const id = randomUUID();
    db.prepare('INSERT INTO users (id) VALUES (?)').run(id);

    // 4 次失败仍不应锁定
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 2; i++) {
      recordFailureAtomic(db, 'users', id);
    }
    let row = db
      .prepare('SELECT failed_attempts, locked_until FROM users WHERE id = ?')
      .get(id) as any;
    expect(row.failed_attempts).toBe(MAX_FAILED_ATTEMPTS - 2);
    expect(row.locked_until).toBeNull();

    // 第 MAX_FAILED_ATTEMPTS - 1 次失败 → 不锁定
    recordFailureAtomic(db, 'users', id);
    row = db.prepare('SELECT failed_attempts, locked_until FROM users WHERE id = ?').get(id) as any;
    expect(row.failed_attempts).toBe(MAX_FAILED_ATTEMPTS - 1);
    expect(row.locked_until).toBeNull();

    // 第 MAX_FAILED_ATTEMPTS 次失败 → 锁定
    const s = recordFailureAtomic(db, 'users', id);
    expect(s.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(s.lockedUntil).not.toBeNull();
    row = db.prepare('SELECT failed_attempts, locked_until FROM users WHERE id = ?').get(id) as any;
    expect(row.failed_attempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(row.locked_until).not.toBeNull();
  });

  it('shares 表：同样支持', () => {
    const db = new Database(':memory:');
    db.exec(
      `CREATE TABLE shares (id TEXT PRIMARY KEY, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT)`
    );
    const id = randomUUID();
    db.prepare('INSERT INTO shares (id) VALUES (?)').run(id);

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      recordFailureAtomic(db, 'shares', id);
    }
    const row = db
      .prepare('SELECT failed_attempts, locked_until FROM shares WHERE id = ?')
      .get(id) as any;
    expect(row.failed_attempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(row.locked_until).not.toBeNull();
  });

  it('并发安全模拟：连续 6 次原子 +1 必须达到锁定', () => {
    const db = new Database(':memory:');
    db.exec(
      `CREATE TABLE users (id TEXT PRIMARY KEY, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT)`
    );
    const id = randomUUID();
    db.prepare('INSERT INTO users (id) VALUES (?)').run(id);

    // 模拟 6 个并发请求同步原子 +1
    const updates = Array.from(
      { length: MAX_FAILED_ATTEMPTS },
      () => () => recordFailureAtomic(db, 'users', id)
    );
    // 同步顺序执行（better-sqlite3 本身串行）
    for (const u of updates) u();
    const row = db
      .prepare('SELECT failed_attempts, locked_until FROM users WHERE id = ?')
      .get(id) as any;
    expect(row.failed_attempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(row.locked_until).not.toBeNull();
  });

  it('记录不存在 ID → 返回 CLEAN_STATE（不抛错）', () => {
    const db = new Database(':memory:');
    db.exec(
      `CREATE TABLE users (id TEXT PRIMARY KEY, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT)`
    );
    const s = recordFailureAtomic(db, 'users', 'nonexistent');
    expect(s.failedAttempts).toBe(0);
    expect(s.lockedUntil).toBeNull();
  });
});
