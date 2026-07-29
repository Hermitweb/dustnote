/**
 * Express 应用
 */

import express, { type Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { config } from './env.js';
import { logger } from './logger.js';
import { versionCheckMiddleware } from './middleware/version-check.js';
import { authMiddleware } from './middleware/auth.js';
import { updateManifestRouter } from './routes/update-manifest.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { notesRouter } from './routes/notes.js';
import { foldersRouter } from './routes/folders.js';
import { tagsRouter } from './routes/tags.js';
import { sharesRouter, publicSharesRouter } from './routes/shares.js';
import { exportRouter } from './routes/export.js';
import { preferencesRouter } from './routes/preferences.js';

export function createApp(): Application {
  const app = express();

  // 反代层数。必须在任何限流中间件之前设置，否则 req.ip 是 nginx 的地址，
  // express-rate-limit 会把所有客户端算进同一个计数桶（既挡不住爆破，又能被
  // 单个 IP 打成全站 DoS）。见 config.trustProxy 注释。
  app.set('trust proxy', config.trustProxy);

  // 安全头
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // CORS
  // 只允许配置的 webOrigin 与已知本地开发端点
  const allowedOrigins = [
    config.webOrigin,
    'http://localhost:5173',
    'http://localhost:1420',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:1420',
    'tauri://localhost', // Tauri 桌面客户端生产模式
    'https://tauri.localhost', // Tauri 桌面客户端生产模式（HTTPS）
  ];
  app.use(
    cors({
      origin(origin, cb) {
        // 允许同源、无 Origin（如 curl、小程序原生请求）和已知白名单。
        // 不放行时回 cb(null, false)：跨域响应不带 CORS 头即可，
        // 抛 Error 会冒泡到错误处理中间件、把一次策略拒绝变成 500。
        cb(null, !origin || allowedOrigins.includes(origin));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    })
  );

  // Cookie 解析（refresh token）
  app.use(cookieParser());

  // 请求体。单条笔记的密文远小于此，60mb × 600 req/min 的旧上限等于把内存
  // 交给任意匿名客户端支配。导入大文件是客户端逐条加密上传的，不需要这么大。
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false, limit: '10mb' }));

  // HTTP 日志
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    })
  );

  // 全局速率限制：每个 IP 每分钟最多 600 次请求
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'too_many_requests', message: '请求过于频繁，请稍后再试' },
      // 健康检查不计入限流
      skip: (req) => req.path === '/api/v1/health',
    })
  );

  // 健康检查（不走 version-check 也不走 auth）
  app.use('/api/v1', healthRouter);

  // 客户端版本校验
  app.use('/api/v1', versionCheckMiddleware);

  // 公开分享（无需登录）：对公开访问单独限流以防止爬取
  app.use(
    '/api/v1/share/public',
    rateLimit({
      windowMs: 60_000,
      limit: 60,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'too_many_requests', message: '访问过于频繁，请稍后再试' },
    })
  );
  app.use('/api/v1', publicSharesRouter);

  // 鉴权中间件
  app.use('/api/v1', authMiddleware);

  // 路由
  app.use('/api/v1', updateManifestRouter);

  // 认证相关：对 unlock / recover / setup / refresh 做严格限流，防爆破
  // 注意：在 authMiddleware 之后挂载，所以 refresh 路由能正确处理
  app.use(
    [
      '/api/v1/auth/unlock',
      '/api/v1/auth/recover',
      '/api/v1/auth/recovery-params',
      '/api/v1/auth/setup',
      '/api/v1/auth/refresh',
    ],
    rateLimit({
      windowMs: 15 * 60_000, // 15 分钟窗口
      limit: 20, // 每个 IP 最多 20 次
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'too_many_auth_attempts', message: '尝试次数过多，请 15 分钟后再试' },
    })
  );
  app.use('/api/v1', authRouter);
  app.use('/api/v1', notesRouter);
  app.use('/api/v1', foldersRouter);
  app.use('/api/v1', tagsRouter);
  app.use('/api/v1', sharesRouter);
  app.use('/api/v1', exportRouter);
  app.use('/api/v1', preferencesRouter);

  // 404
  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.path });
  });

  // 错误处理
  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      logger.error({ err }, '未捕获错误');
      res.status(500).json({
        error: 'internal_error',
        message: config.nodeEnv === 'production' ? '服务异常' : err.message,
      });
    }
  );

  return app;
}
