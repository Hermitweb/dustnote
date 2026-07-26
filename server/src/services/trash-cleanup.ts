/**
 * 回收站自动清理
 *
 * 策略（与 roadmap §M1 一致）：
 * - 软删除超过 30 天的笔记定期永久删除
 * - 服务端启动时跑一次，之后每小时跑一次
 * - 单用户场景下 notes 表数据量有限，全表扫描开销可忽略
 *
 * 注意：永久删除不可恢复，且会触发 broadcastNoteChanged 让在线设备
 * 同步移除该笔记。这里为了简单不广播（启动时通常无在线设备），
 * 客户端会在下次 loadAll 时自然不再拿到这些笔记。
 */

import { getDb } from '../db.js';
import { logger } from '../logger.js';

export const TRASH_RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 小时

/**
 * 永久删除已软删超过 TRASH_RETENTION_DAYS 天的笔记。
 * 返回删除条数。now 参数允许测试注入时间。
 */
export function purgeExpiredTrash(now: Date = new Date()): number {
  const db = getDb();
  // deleted_at 存的是 ISO 字符串或 datetime('now') 生成的 UTC 字符串，
  // 两者都能被 new Date() 解析。用毫秒级比较避免时区歧义。
  const cutoffMs = now.getTime() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs).toISOString();

  const result = db
    .prepare(
      `
    DELETE FROM notes
    WHERE deleted_at IS NOT NULL AND deleted_at < ?
  `
    )
    .run(cutoff);

  if (result.changes > 0) {
    logger.info(
      { purged: result.changes, cutoff, retentionDays: TRASH_RETENTION_DAYS },
      '回收站自动清理：已永久删除过期笔记'
    );
  }
  return result.changes;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** 启动定期清理（启动时立即跑一次） */
export function startTrashCleanup(): void {
  // 启动时先跑一次，清掉停机期间积压的过期笔记
  try {
    purgeExpiredTrash();
  } catch (err) {
    logger.warn({ err }, '启动时回收站清理失败（非致命）');
  }
  timer = setInterval(() => {
    try {
      purgeExpiredTrash();
    } catch (err) {
      logger.warn({ err }, '定时回收站清理失败（非致命）');
    }
  }, CLEANUP_INTERVAL_MS);
  // unref 让定时器不阻止进程退出（优雅关闭时由 stopTrashCleanup 清理）
  if (timer && typeof timer.unref === 'function') timer.unref();
  logger.info({ intervalMin: CLEANUP_INTERVAL_MS / 60_000 }, '回收站定期清理已启动');
}

/** 停止定期清理（优雅关闭时调用） */
export function stopTrashCleanup(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
