/**
 * 服务端 SQLite 自动备份脚本
 *
 * 设计：
 * - 使用 SQLite Online Backup API（.backup()），不锁库、不阻塞读写
 * - 按日期滚动备份，保留最近 N 份
 * - 支持手动执行 / cron 定时执行
 *
 * 防坑：SQLite 单文件，一次磁盘故障 = 全部数据丢失。
 * 这是个人项目数据安全的最后一道防线。
 *
 * 用法：
 *   # 手动执行一次备份
 *   pnpm --filter @dustnote/server exec tsx src/scripts/backup.ts
 *
 *   # cron 每日凌晨 3 点备份（crontab -e）
 *   0 3 * * * cd /app && node dist/scripts/backup.js
 */

import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../env.js';
import { getDb } from '../db.js';
import { logger } from '../logger.js';

const BACKUP_DIR = config.backupDir ?? join(process.cwd(), 'backups');
const RETENTION_COUNT = Number(config.backupRetention ?? 30);

/**
 * 执行一次在线备份
 * @returns 备份文件路径
 */
export async function backupDatabase(): Promise<string> {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const backupPath = join(BACKUP_DIR, `db-${ts}.sqlite`);

  await mkdir(BACKUP_DIR, { recursive: true });

  // SQLite Online Backup：不锁库，可在线执行，传文件路径
  const sourceDb = getDb() as unknown as InstanceType<typeof Database>;
  sourceDb.backup(backupPath);
  const stats = await stat(backupPath);
  logger.info(
    { path: backupPath, sizeMB: (stats.size / 1048576).toFixed(2) },
    'SQLite 备份完成'
  );
  return backupPath;
}

/**
 * 清理旧备份，仅保留最近 RETENTION_COUNT 份
 */
export async function pruneOldBackups(): Promise<{ deleted: number; kept: number }> {
  let files: string[];
  try {
    files = await readdir(BACKUP_DIR);
  } catch {
    return { deleted: 0, kept: 0 };
  }

  const backups = files
    .filter((f) => /^db-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.sqlite$/.test(f))
    .sort()
    .reverse(); // 最新的在前

  const toDelete = backups.slice(RETENTION_COUNT);
  for (const f of toDelete) {
    await unlink(join(BACKUP_DIR, f));
  }

  logger.info(
    { deleted: toDelete.length, kept: backups.length - toDelete.length },
    '旧备份清理完成'
  );
  return { deleted: toDelete.length, kept: backups.length - toDelete.length };
}

/** 完整的备份流程：备份 + 清理 */
export async function runBackup(): Promise<void> {
  try {
    await backupDatabase();
    await pruneOldBackups();
  } catch (err) {
    logger.error({ err }, '备份失败');
    throw err;
  }
}

// 直接执行时运行
if (import.meta.url === `file://${process.argv[1]}`) {
  runBackup()
    .then(() => {
      console.log('✅ 备份完成');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ 备份失败:', err);
      process.exit(1);
    });
}
