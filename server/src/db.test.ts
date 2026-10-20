/**
 * server/src/db.ts 单测 —— SQLite 连接 + 迁移执行 + schema 水位
 *
 * getDb() 用临时文件（避免和真实 data/ 冲突），mock 掉 env.config 让 dbPath 指向
 * 临时目录；migration 的 backup 路径也用临时 backup 目录覆盖。
 */
import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

const tmpDir = mkdtempSync(join(tmpdir(), 'db-test-'));
const tmpDb = join(tmpDir, 'test.sqlite');
const tmpBackup = join(tmpDir, 'backups');

vi.mock('../env.js', () => ({
  config: { dbPath: '', backupDir: '' }, // 每个 test 覆盖
}));
vi.mock('../logger.js', () => ({
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));

// 每个 test 重新加载 db.ts 模块，让 dbInstance 重置 + config 注入最新值
async function loadDb() {
  vi.resetModules();
  // mock 内层路径需要走完整模块解析
  vi.doMock('../env.js', () => ({ config: { dbPath: tmpDb, backupDir: tmpBackup } }));
  vi.doMock('../logger.js', () => ({
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    },
  }));
  return import('./db.js');
}

describe('getDb / closeDb', () => {
  beforeEach(() => {
    if (existsSync(tmpDb)) rmSync(tmpDb);
    if (existsSync(tmpBackup)) rmSync(tmpBackup, { recursive: true });
  });
  afterAll(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  it('首次 getDb → 建立连接 + 应用 pragmas（journal_mode=WAL）', async () => {
    const { getDb, closeDb } = await loadDb();
    const db = getDb();
    expect(db).toBeInstanceOf(Database);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    closeDb();
  });

  it('多次 getDb → 返回同一实例（单例）', async () => {
    const { getDb, closeDb } = await loadDb();
    const a = getDb();
    const b = getDb();
    expect(a).toBe(b);
    closeDb();
  });

  it('closeDb → 关闭后 getDb 重新建连接', async () => {
    const { getDb, closeDb } = await loadDb();
    const a = getDb();
    closeDb();
    const b = getDb();
    expect(a).not.toBe(b);
    b.close();
  });
});

describe('assertSchemaNotNewerThan', () => {
  it('库水位 ≤ 已知最大 → 静默通过', async () => {
    const { assertSchemaNotNewerThan } = await loadDb();
    const db = new Database(':memory:');
    db.pragma('user_version = 5');
    expect(() => assertSchemaNotNewerThan(db, 10)).not.toThrow();
    db.close();
  });

  it('库水位 > 已知最大 → 抛错（拒绝降级启动）', async () => {
    const { assertSchemaNotNewerThan } = await loadDb();
    const db = new Database(':memory:');
    db.pragma('user_version = 11');
    expect(() => assertSchemaNotNewerThan(db, 10)).toThrow(/高于当前代码支持的版本/);
    db.close();
  });
});

describe('recordSchemaVersion', () => {
  it('写入 user_version', async () => {
    const { recordSchemaVersion } = await loadDb();
    const db = new Database(':memory:');
    recordSchemaVersion(db, 17);
    expect(db.pragma('user_version', { simple: true })).toBe(17);
    db.close();
  });
});

describe('runMigrations', () => {
  it('建 _migrations 表 + 按 id 顺序执行', async () => {
    const { runMigrations } = await loadDb();
    const db = new Database(':memory:');
    const calls: number[] = [];
    const migrations = [
      {
        id: 1,
        name: 'create_users',
        up: (d: DatabaseType) => {
          calls.push(1);
          d.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
        },
      },
      {
        id: 2,
        name: 'create_notes',
        up: (d: DatabaseType) => {
          calls.push(2);
          d.exec('CREATE TABLE notes (id TEXT PRIMARY KEY)');
        },
      },
    ];
    await runMigrations(db, migrations);
    expect(calls).toEqual([1, 2]);
    // _migrations 记录
    const rows = db.prepare('SELECT id, name FROM _migrations ORDER BY id').all();
    expect(rows).toEqual([
      { id: 1, name: 'create_users' },
      { id: 2, name: 'create_notes' },
    ]);
    // user_version 写入
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    db.close();
  });

  it('已执行的迁移跳过（幂等）', async () => {
    const { runMigrations } = await loadDb();
    const db = new Database(':memory:');
    let count = 0;
    const migrations = [{ id: 1, name: 'a', up: () => void count++ }];
    await runMigrations(db, migrations);
    await runMigrations(db, migrations);
    expect(count).toBe(1);
    db.close();
  });

  it('迁移 up 抛错 → 抛出，事务回滚', async () => {
    const { runMigrations } = await loadDb();
    const db = new Database(':memory:');
    const migrations = [
      {
        id: 1,
        name: 'bad',
        up: () => {
          throw new Error('boom');
        },
      },
    ];
    await expect(runMigrations(db, migrations)).rejects.toThrow(/boom/);
    // _migrations 没有记录
    const row = db.prepare('SELECT 1 FROM _migrations WHERE id = 1').get();
    expect(row).toBeUndefined();
    db.close();
  });

  it('库水位 > 最大迁移 id → 抛错（拒绝降级）', async () => {
    const { runMigrations } = await loadDb();
    const db = new Database(':memory:');
    db.pragma('user_version = 99');
    let called = false;
    const migrations = [{ id: 1, name: 'a', up: () => void (called = true) }];
    await expect(runMigrations(db, migrations)).rejects.toThrow(/高于当前代码/);
    expect(called).toBe(false);
    db.close();
  });

  it('空迁移列表 → 仅建 _migrations 表 + user_version=0', async () => {
    const { runMigrations } = await loadDb();
    const db = new Database(':memory:');
    await runMigrations(db, []);
    expect(db.pragma('user_version', { simple: true })).toBe(0);
    const hasTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
      .get();
    expect(hasTable).toBeDefined();
    db.close();
  });
});

describe('破坏性迁移备份门槛', () => {
  it('空库（无 users 行）→ 跳过备份，直接迁移', async () => {
    const { runMigrations } = await loadDb();
    const db = new Database(':memory:');
    let upCalled = false;
    const migrations = [
      { id: 1, name: 'a', up: () => void (upCalled = true) },
      { id: 2, name: 'b', destructive: true, up: () => void (upCalled = true) },
    ];
    await runMigrations(db, migrations);
    expect(upCalled).toBe(true);
    db.close();
  });

  it('非空库 + 已有今日备份 → 不再备份，直接迁移', async () => {
    const { runMigrations } = await loadDb();
    const db = new Database(':memory:');
    db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO users (id) VALUES (?)').run('u1');
    // 预先放置今日备份文件
    if (!existsSync(tmpBackup)) require('node:fs').mkdirSync(tmpBackup, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(join(tmpBackup, `db-${today}-manual.sqlite`), 'fake');
    const migrations = [
      { id: 1, name: 'a', up: () => db.exec('CREATE TABLE x (id INT)') },
      { id: 2, name: 'b', destructive: true, up: () => void 0 },
    ];
    await runMigrations(db, migrations);
    // 备份目录只有我们手工放的那一份
    expect(readdirSync(tmpBackup).filter((f) => f.startsWith(`db-${today}`)).length).toBe(1);
    db.close();
  });

  it('非空库 + 无今日备份 → 现场 backup 一次后再迁移', async () => {
    const { runMigrations } = await loadDb();
    const db = new Database(':memory:');
    db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO users (id) VALUES (?)').run('u1');
    const migrations = [
      { id: 1, name: 'a', up: () => db.exec('CREATE TABLE x (id INT)') },
      { id: 2, name: 'b', destructive: true, up: () => void 0 },
    ];
    await runMigrations(db, migrations);
    // 应有今天的备份（SQLite .backup 落地）
    const today = new Date().toISOString().slice(0, 10);
    const files = readdirSync(tmpBackup).filter((f) => f.startsWith(`db-${today}`));
    expect(files.length).toBeGreaterThanOrEqual(1);
    db.close();
  });
});
