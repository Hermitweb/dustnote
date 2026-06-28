/**
 * SQLite 连接 + 迁移执行
 *
 * 迁移策略：
 * - 表 _migrations 记录已执行的 id
 * - 启动时按 id 顺序执行未执行的迁移
 * - 事务包裹，单条失败回滚
 */

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from './env.js';
import { logger } from './logger.js';

export type Migration = {
  id: number;
  name: string;
  up: (db: DatabaseType) => void;
};

let dbInstance: DatabaseType | null = null;

export function getDb(): DatabaseType {
  if (dbInstance) return dbInstance;

  const dbPath = resolve(config.dbPath);
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); // 写并发 + 崩溃恢复
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  dbInstance = db;
  logger.info({ dbPath }, 'SQLite 连接已建立');
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/** 执行迁移列表 */
export function runMigrations(db: DatabaseType, migrations: Migration[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db.prepare('SELECT id FROM _migrations ORDER BY id').all().map((r) => (r as { id: number }).id)
  );

  for (const m of migrations) {
    if (applied.has(m.id)) {
      logger.debug({ id: m.id, name: m.name }, '跳过已执行迁移');
      continue;
    }

    const start = Date.now();
    const txn = db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(m.id, m.name);
    });
    try {
      txn();
      logger.info(
        { id: m.id, name: m.name, ms: Date.now() - start },
        '迁移完成'
      );
    } catch (err) {
      logger.error({ id: m.id, name: m.name, err }, '迁移失败');
      throw err;
    }
  }
}
