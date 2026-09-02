/**
 * 回收站自动清理
 *
 * 策略（与 roadmap §M1 一致）：
 * - 软删除超过 30 天的笔记定期永久删除
 * - 服务端启动时跑一次，之后每小时跑一次
 * - 单用户场景下 notes 表数据量有限，全表扫描开销可忽略
 *
 * 永久删除不可恢复，会触发 broadcastNoteChanged 让在线设备
 * 同步移除该笔记（op: 'permanent_delete'），避免客户端残留本地副本。
 */

import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { broadcastNoteChanged } from './sync-ws.js';

export const TRASH_RETENTION_DAYS = 30;
export const SHARE_RETENTION_DAYS = 30; // 分享失效后密文保留天数
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 小时

/**
 * 永久删除已软删超过 TRASH_RETENTION_DAYS 天的笔记。
 * 返回删除条数。now 参数允许测试注入时间。
 */
export function purgeExpiredTrash(now: Date = new Date()): number {
  const db = getDb();
  // deleted_at 历史上有两种入库格式：旧版 datetime('now')（"YYYY-MM-DD HH:MM:SS"）与
  // ISO-8601（"…T…Z"）。直接按 TEXT 字节序比较会产生「同日时空格(0x20) < 'T'(0x54)」的
  // 偏差，导致删除满 29 天的笔记被提前永久删除。统一用 julianday() 解析后再比较，
  // 两种格式都能正确解析，且空串/非法值解析为 NULL（NULL < x 恒为假，不会被清理）。
  const cutoffMs = now.getTime() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs).toISOString();

  // 先查出待删除笔记的 id + user_id，用于广播；再执行 DELETE。
  // 单用户场景下数据量有限，且 30 天保留期保证单次清理量可控。
  const toPurge = db
    .prepare(
      `SELECT id, user_id FROM notes
       WHERE deleted_at IS NOT NULL AND julianday(deleted_at) < julianday(?)`
    )
    .all(cutoff) as { id: string; user_id: string }[];

  if (toPurge.length === 0) return 0;

  const result = db
    .prepare(
      `
    DELETE FROM notes
    WHERE deleted_at IS NOT NULL AND julianday(deleted_at) < julianday(?)
  `
    )
    .run(cutoff);

  // 广播永久删除事件，让在线设备同步移除该笔记
  for (const n of toPurge) {
    broadcastNoteChanged(n.user_id, { id: n.id, op: 'permanent_delete' });
  }

  if (result.changes > 0) {
    logger.info(
      { purged: result.changes, cutoff, retentionDays: TRASH_RETENTION_DAYS },
      '回收站自动清理：已永久删除过期笔记'
    );
  }

  // 过期/吊销分享的密文清除：shares 表的 ciphertext/wrapped_share_key 在
  // 分享失效 30 天后删除，兑现「服务端最小化留存」承诺（非致命，表缺失/
  // 局部异常不影响主流程）
  const shareCutoff = new Date(now.getTime() - SHARE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    const purgedShares = db
      .prepare(
        `UPDATE shares
         SET ciphertext = NULL, wrapped_share_key = NULL
         WHERE (
           (expires_at IS NOT NULL AND expires_at < ?)
           OR revoked = 1
         )
         AND (ciphertext IS NOT NULL OR wrapped_share_key IS NOT NULL)`,
      )
      .run(shareCutoff);
    if (purgedShares.changes > 0) {
      logger.info(
        { purged: purgedShares.changes, cutoff: shareCutoff, retentionDays: SHARE_RETENTION_DAYS },
        '分享自动清理：已清除失效分享的密文'
      );
    }
  } catch (err) {
    logger.warn({ err }, '分享密文清理失败（非致命）');
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
