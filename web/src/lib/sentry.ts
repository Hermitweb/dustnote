/**
 * Sentry 错误监控初始化（Web / 桌面端）
 *
 * 仅在 VITE_SENTRY_DSN 环境变量配置时启用；未配置时所有 API 均为 no-op。
 * 自托管部署可不填 DSN，不影响应用运行。
 */

import * as Sentry from '@sentry/react';

let initialized = false;

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.PROD ? 'production' : 'development',
    release: `dustnote-web@${__APP_VERSION__}`,
    tracesSampleRate: 0, // 关闭性能监控，仅收集错误
    /**
     * 隐私保护：剥离可能的 PII（用户输入的笔记标题可能出现在 breadcrumb 中）
     */
    beforeSend(event) {
      // 清理 breadcrumb 中的敏感数据
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((crumb) => {
          if (crumb.category === 'ui.input' || crumb.category === 'ui.click') {
            delete crumb.message;
          }
          return crumb;
        });
      }
      return event;
    },
  });

  initialized = true;
}

/** 捕获异常到 Sentry（未初始化时为 no-op） */
export function captureException(err: unknown): void {
  if (initialized) {
    Sentry.captureException(err);
  }
}

/** 是否已初始化 */
export function isSentryEnabled(): boolean {
  return initialized;
}

export { Sentry };
