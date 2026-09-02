/**
 * 启动入口
 */

import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './env.js';
import { logger } from './logger.js';
import { getDb, runMigrations, closeDb } from './db.js';
import { migrations } from './migrations.js';
import { setupSyncWss, closeWss } from './services/sync-ws.js';
import { startTrashCleanup, stopTrashCleanup } from './services/trash-cleanup.js';
import { startBackupSchedule, stopBackupSchedule } from './services/backup-scheduler.js';
import { initSentry, captureException } from './sentry.js';
import { ACTIVE_ALGORITHM } from './auth/jwt.js';

// 启动时配置校验
import './config-validate.js';

async function main(): Promise<void> {
  // 0. 初始化 Sentry（必须在 app 创建之前；未配置 DSN 时为 no-op）
  initSentry();

  // 1. 初始化数据库 + 跑迁移
  const db = getDb();
  runMigrations(db, migrations);

  // 1.5 幂等列 ensure：TOTP 防重放计数器（轻量列级 ensure,不占迁移条目；
  // 首次部署/升级自动补列,已存在则跳过）
  const totpCol = (
    db.prepare("PRAGMA table_info('users')").all() as { name: string }[]
  ).some((c) => c.name === 'totp_last_counter');
  if (!totpCol) {
    db.exec('ALTER TABLE users ADD COLUMN totp_last_counter INTEGER NOT NULL DEFAULT -1');
    logger.info('已补列 users.totp_last_counter（TOTP 防重放）');
  }

  // 2. 创建 HTTP 服务
  const app = createApp();
  const httpServer = createServer(app);

  // 请求超时：避免慢速攻击把连接长期挂住耗尽句柄
  httpServer.requestTimeout = 30_000;
  httpServer.headersTimeout = 65_000;
  httpServer.keepAliveTimeout = 60_000;
  httpServer.timeout = 120_000;

  // 3. 启动 WebSocket
  setupSyncWss(httpServer);

  // 4. 启动回收站定期清理（30 天过期笔记永久删除）
  startTrashCleanup();
  startBackupSchedule();

  // 5. 启动
  httpServer.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        env: config.nodeEnv,
        version: config.serverVersion,
        jwtAlg: ACTIVE_ALGORITHM,
      },
      `🚀 DustNote 服务端已启动  http://localhost:${config.port}  (JWT: ${ACTIVE_ALGORITHM})`
    );
  });

  // 6. 优雅关闭（重入守卫：信号 + 致命异常可能并发触发，避免重复关闭）
  let shuttingDown = false;
  const shutdown = async (reason: string, code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ reason }, '开始优雅退出');
    try {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      stopTrashCleanup();
      stopBackupSchedule();
      await closeWss();
      closeDb();
      logger.info('已关闭 HTTP/WS/DB');
    } catch (err) {
      logger.error({ err }, '优雅退出过程中出错');
    }
    process.exit(code);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  // 进程级兜底：漏网的同步异常/异步 rejection 若不接住，Node 15+ 默认
  // --unhandled-rejections=throw 会打死进程，且不走优雅关闭流程，SQLite WAL
  // 可能未正常 checkpoint、正在写的事务不保证回滚。这里接住后触发优雅关闭。
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException — 触发优雅关闭');
    captureException(err);
    void shutdown('uncaughtException', 1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'unhandledRejection — 触发优雅关闭');
    void shutdown('unhandledRejection', 1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, '启动失败');
  captureException(err);
  process.exit(1);
});
