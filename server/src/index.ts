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

// 启动时配置校验
import './config-validate.js';

async function main(): Promise<void> {
  // 1. 初始化数据库 + 跑迁移
  const db = getDb();
  runMigrations(db, migrations);

  // 2. 创建 HTTP 服务
  const app = createApp();
  const httpServer = createServer(app);

  // 3. 启动 WebSocket
  setupSyncWss(httpServer);

  // 4. 启动
  httpServer.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv, version: config.serverVersion },
      `🚀 DustNote 服务端已启动  http://localhost:${config.port}`
    );
  });

  // 5. 优雅关闭
  const shutdown = async (signal: string) => {
    logger.info({ signal }, '收到关闭信号，开始优雅退出');
    httpServer.close();
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
  process.exit(1);
});
