/**
 * Sentry 错误监控初始化
 *
 * 仅在 SENTRY_DSN 环境变量配置时启用；未配置时所有 API 均为 no-op。
 * 自托管部署可不填 DSN，不影响服务运行。
 *
 * @sentry/node v8+ 使用 setupExpressErrorHandler 替代旧的 Handlers.requestHandler / errorHandler。
 */

import * as Sentry from '@sentry/node';
import { setupExpressErrorHandler } from '@sentry/node';
import type { Application } from 'express';
import { config } from './env.js';
import { logger } from './logger.js';

let initialized = false;

export function initSentry(): void {
  if (!config.sentryDsn) {
    logger.info('Sentry 已禁用（未配置 SENTRY_DSN）');
    return;
  }

  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    release: `dustnote-server@${config.serverVersion}`,
    tracesSampleRate: 0, // 关闭性能监控，仅收集错误
    /**
     * 隐私保护：剥离请求体（可能含加密笔记密文，虽然对服务端也是密文，
     * 但体积大且无用），仅保留 URL、method、headers 中的 User-Agent。
     */
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          const ua = event.request.headers['user-agent'];
          event.request.headers = ua ? { 'user-agent': ua } : {};
        }
      }
      return event;
    },
  });

  initialized = true;
  logger.info('Sentry 已启用');
}

/**
 * 为 Express 应用挂载 Sentry 错误处理中间件。
 * 必须在所有路由注册之后、自定义错误处理中间件之前调用。
 * 未初始化时为 no-op。
 */
export function setupSentryErrorHandler(app: Application): void {
  if (!initialized) return;
  setupExpressErrorHandler(app);
}

/** 捕获异常到 Sentry（未初始化时为 no-op） */
export function captureException(err: unknown): void {
  if (initialized) {
    Sentry.captureException(err);
  }
}
