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

  // 2. 创建 HTTP 服务
  const app = createApp();
  const httpServer = createServer(app);

  // 3. 启动 WebSocket
  setupSyncWss(httpServer);

  // 4. 启动回收站定期清理（30 天过期笔记永久删除）
  startTrashCleanup();

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

  // 6. 优雅关闭
  const shutdown = async (signal: string) => {
    logger.info({ signal }, '收到关闭信号，开始优雅退出');
    httpServer.close();
    stopTrashCleanup();
    await closeWss();
    closeDb();
    logger.info('已关闭 HTTP/WS/DB');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, '启动失败');
  captureException(err);
  process.exit(1);
});
