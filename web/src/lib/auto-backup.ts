/**
 * 自动备份（已废弃）——遗留数据清理接口
 *
 * 审计 LIFE-005：本模块原设计为「每日静默自动备份到 IndexedDB」，且备份
 * 内容是解密后的笔记明文——一旦接线会直接破坏 E2EE 的静态加密承诺，而该
 * 调度自始至终没有被任何页面调用过（死代码）。为避免将来误启用，明文备份
 * 的写入/恢复函数（performAutoBackup / restoreAutoBackup 等）已删除；
 * 服务端已有加密的每日自动备份（server/src/services/backup-scheduler.ts）。
 *
 * 这里仅保留两个遗留接口：
 * - getLastBackupTime：诊断面板读取历史时间戳（新部署恒为 null，无害）
 * - clearAutoBackups：删除账户/清理数据时抹掉历史遗留的 IndexedDB 备份
 */

import { get, del } from 'idb-keyval';
import { logger } from './diagnostics';

const AUTO_BACKUPS_KEY = 'dustnote:auto-backups';
const LAST_BACKUP_KEY = 'dustnote:last-auto-backup';

/** 获取上次自动备份时间（历史遗留；新部署恒为 null。用于设置页显示） */
export async function getLastBackupTime(): Promise<string | null> {
  return (await get<string>(LAST_BACKUP_KEY)) ?? null;
}

/** 清空所有自动备份遗留数据（用户主动清理时调用） */
export async function clearAutoBackups(): Promise<void> {
  await del(AUTO_BACKUPS_KEY);
  await del(LAST_BACKUP_KEY);
  void logger.info('auto-backup', '已清理自动备份遗留数据');
}
