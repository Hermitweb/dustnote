/**
 * 自动备份调度
 *
 * 此前 compose 挂了备份卷并声明「自动备份」，但容器内没有任何调度——
 * SQLite 单文件 + 备份链路名存实亡，是 E2EE 系统最大的实际数据丢失面。
 * 这里在服务端进程内做每日调度（无需额外 cron）：
 * - 启动 60s 后先跑一次，补上停机期间的备份空档
 * - 之后每 24 小时一次（runBackup 内含保留期清理）
 * 失败仅告警不影响服务运行。
 */
import { runBackup } from '../scripts/backup.js';
import { logger } from '../logger.js';

const INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let firstTimer: ReturnType<typeof setTimeout> | null = null;

export function startBackupSchedule(): void {
  if (timer) return;
  firstTimer = setTimeout(() => {
    void runBackup().catch((err) => logger.error({ err }, '启动备份失败（非致命）'));
  }, FIRST_RUN_DELAY_MS);
  if (typeof firstTimer.unref === 'function') firstTimer.unref();

  timer = setInterval(() => {
    void runBackup().catch((err) => logger.error({ err }, '每日备份失败（非致命）'));
  }, INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info({ intervalHours: INTERVAL_MS / 3_600_000 }, '自动备份调度已启动');
}

export function stopBackupSchedule(): void {
  if (timer) clearInterval(timer);
  if (firstTimer) clearTimeout(firstTimer);
  timer = null;
  firstTimer = null;
}
