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
import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { captureException } from '../sentry.js';
import { backupRunsTotal } from '../metrics.js';

const INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;
/** 每 N 次每日维护做一次 VACUUM（物理回收软删/已删页，审计 LIFE-022） */
const VACUUM_EVERY_RUNS = 7;

/** 备份失败必须升级告警（审计 M2）：仅 logger.error 无人盯着就是静默丢备份。 */
function onBackupFailure(where: string, err: unknown): void {
  logger.error({ err, where }, `${where}备份失败——数据安全的最后一道防线失效,请立即排查`);
  // 配置了 DSN 时进 Sentry 聚合告警;未配置时 no-op
  captureException(
    err instanceof Error ? err : new Error(`backup failed (${where}): ${String(err)}`)
  );
}

let timer: ReturnType<typeof setInterval> | null = null;
let firstTimer: ReturnType<typeof setTimeout> | null = null;
let dailyRunCount = 0;

/** SQLite 例行维护（审计 LIFE-022）：checkpoint 收缩 WAL；周期性 VACUUM 物理回收 */
function sqliteMaintenance(): void {
  try {
    getDb().pragma('wal_checkpoint(TRUNCATE)');
    if (dailyRunCount % VACUUM_EVERY_RUNS === 0) {
      getDb().exec('VACUUM');
      logger.info('SQLite VACUUM 完成（软删/已删数据物理回收）');
    }
  } catch (err) {
    logger.warn({ err }, 'SQLite 例行维护失败（不影响服务）');
  }
}

export function startBackupSchedule(): void {
  if (timer) return;
  firstTimer = setTimeout(() => {
    void runBackup()
      .then(() => backupRunsTotal.inc({ result: 'ok' }))
      .catch((err) => {
        backupRunsTotal.inc({ result: 'fail' });
        onBackupFailure('启动', err);
      });
  }, FIRST_RUN_DELAY_MS);
  if (typeof firstTimer.unref === 'function') firstTimer.unref();

  timer = setInterval(() => {
    dailyRunCount += 1;
    void runBackup()
      .then(() => backupRunsTotal.inc({ result: 'ok' }))
      .catch((err) => {
        backupRunsTotal.inc({ result: 'fail' });
        onBackupFailure('每日', err);
      })
      .finally(() => sqliteMaintenance());
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
