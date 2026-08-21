/**
 * 每日静默自动备份
 *
 * 设计：
 * - 联机模式：每日首次解锁后，静默增量备份到本地 IndexedDB（保留最近 7 份）
 * - 单机模式：每日首次解锁后，静默全量备份到 IndexedDB（保留最近 7 份）
 * - 不打扰用户，无 Toast，仅在设置页可见"上次备份时间"
 *
 * 防坑：防止用户长期不手动备份导致数据丢失。
 * 与手动 backup 的区别：自动备份存 IndexedDB（本地），手动备份存文件（可迁移）。
 */

import { get, set, del } from 'idb-keyval';
import { logger } from './diagnostics';

const AUTO_BACKUPS_KEY = 'dustnote:auto-backups';
const LAST_BACKUP_KEY = 'dustnote:last-auto-backup';
const MAX_AUTO_BACKUPS = 7;

export interface AutoBackup {
  /** ISO 时间戳 */
  ts: string;
  /** 备份时的笔记数量 */
  noteCount: number;
  /** 备份内容（解密后的明文，存本地 IndexedDB） */
  data: {
    notes: [string, unknown][];
    folders: unknown[];
    tags: unknown[];
  };
}

/** 检查今天是否已备份 */
export async function isBackedUpToday(): Promise<boolean> {
  const last = await get<string>(LAST_BACKUP_KEY);
  if (!last) return false;
  const lastDate = new Date(last).toDateString();
  const today = new Date().toDateString();
  return lastDate === today;
}

/**
 * 执行一次自动备份
 * @param notes 笔记 Map
 * @param folders 文件夹数组
 * @param tags 标签数组
 */
export async function performAutoBackup(
  notes: Map<string, unknown>,
  folders: unknown[],
  tags: unknown[]
): Promise<void> {
  const backups = (await get<AutoBackup[]>(AUTO_BACKUPS_KEY)) ?? [];

  const backup: AutoBackup = {
    ts: new Date().toISOString(),
    noteCount: notes.size,
    data: {
      notes: Array.from(notes.entries()),
      folders,
      tags,
    },
  };

  backups.push(backup);
  // 滚动保留最近 MAX_AUTO_BACKUPS 份
  if (backups.length > MAX_AUTO_BACKUPS) {
    backups.splice(0, backups.length - MAX_AUTO_BACKUPS);
  }

  await set(AUTO_BACKUPS_KEY, backups);
  await set(LAST_BACKUP_KEY, backup.ts);

  await logger.info('auto-backup', '每日自动备份完成', {
    noteCount: backup.noteCount,
    totalBackups: backups.length,
  });
}

/** 获取上次备份时间（用于设置页显示） */
export async function getLastBackupTime(): Promise<string | null> {
  return (await get<string>(LAST_BACKUP_KEY)) ?? null;
}

/** 获取所有自动备份列表（用于恢复界面） */
export async function listAutoBackups(): Promise<Array<{ ts: string; noteCount: number }>> {
  const backups = (await get<AutoBackup[]>(AUTO_BACKUPS_KEY)) ?? [];
  return backups.map((b) => ({ ts: b.ts, noteCount: b.noteCount })).reverse();
}

/** 恢复指定时间点的备份 */
export async function restoreAutoBackup(ts: string): Promise<AutoBackup | null> {
  const backups = (await get<AutoBackup[]>(AUTO_BACKUPS_KEY)) ?? [];
  return backups.find((b) => b.ts === ts) ?? null;
}

/** 清空所有自动备份（用户主动清理时调用） */
export async function clearAutoBackups(): Promise<void> {
  await del(AUTO_BACKUPS_KEY);
  await del(LAST_BACKUP_KEY);
}
