/**
 * SQLite 连接 + 迁移执行
 *
 * 迁移策略：
 * - 表 _migrations 记录已执行的 id
 * - 启动时按 id 顺序执行未执行的迁移
 * - 事务包裹，单条失败回滚
 */

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { config } from './env.js';
import { logger } from './logger.js';

export type Migration = {
  id: number;
  name: string;
  /** 破坏性迁移（重建表/删数据）：执行前强制当日备份存在,否则现场备份一次 */
  destructive?: boolean;
  up: (db: DatabaseType) => void;
};

let dbInstance: DatabaseType | null = null;

/**
 * 破坏性迁移的备份门槛（审计 M4）：每日自动备份在启动 60s 后才跑,而迁移在
 * 启动最前面执行——误判数据形态的破坏性迁移上线时没有当日快照可回退。
 * 门槛：backups 目录里没有今天的备份文件时,先用 SQLite Online Backup API
 * 现场备一份（不锁库;必须 await 完成）。
 */
async function ensureBackupBeforeDestructiveMigration(
  db: DatabaseType,
  m: Migration
): Promise<void> {
  const backupDir = config.backupDir ?? join(process.cwd(), 'backups');
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
  const todayPrefix = `db-${new Date().toISOString().slice(0, 10)}`;
  const hasTodayBackup = readdirSync(backupDir).some((f) => f.startsWith(todayPrefix));
  if (hasTodayBackup) return;

  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const backupPath = join(backupDir, `db-${ts}.sqlite`);
  await db.backup(backupPath);
  logger.warn(
    { migrationId: m.id, migrationName: m.name, backupPath },
    '破坏性迁移执行前无当日备份,已现场补备份'
  );
}

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
export async function runMigrations(db: DatabaseType, migrations: Migration[]): Promise<void> {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db
      .prepare('SELECT id FROM _migrations ORDER BY id')
      .all()
      .map((r) => (r as { id: number }).id)
  );

  for (const m of migrations) {
    if (applied.has(m.id)) {
      logger.debug({ id: m.id, name: m.name }, '跳过已执行迁移');
      continue;
    }

    if (m.destructive) {
      await ensureBackupBeforeDestructiveMigration(db, m);
    }

    const start = Date.now();
    const txn = db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(m.id, m.name);
    });
    try {
      txn();
      logger.info({ id: m.id, name: m.name, ms: Date.now() - start }, '迁移完成');
    } catch (err) {
      logger.error({ id: m.id, name: m.name, err }, '迁移失败');
      throw err;
    }
  }
}
