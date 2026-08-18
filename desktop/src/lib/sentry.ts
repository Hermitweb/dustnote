/**
 * Sentry 桥接层（当前为 no-op stub）
 *
 * main.tsx 在 React 渲染前调用 initSentry()，并用 <Sentry.ErrorBoundary> 包裹 App。
 * 当未安装 @sentry/react 或未配置 VITE_SENTRY_DSN 时，全部为 no-op / console 回退：
 *   - initSentry()          — 无操作
 *   - captureException()    — 开发环境打印 console.error，生产环境静默
 *   - Sentry.ErrorBoundary  — 仍提供 React 错误边界（捕获渲染异常并显示 fallback UI）
 *
 * 如需启用真正的 Sentry 上报：
 *   1. pnpm --filter @dustnote/desktop add @sentry/react
 *   2. 将本文件改为 re-export @sentry/react 的对应导出
 *   3. 在 initSentry 中调用 Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN })
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';

interface FallbackProps {
  error: Error;
}

type FallbackRender = (props: FallbackProps) => ReactNode;

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode | FallbackRender;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 轻量 React 错误边界（替代 @sentry/react 的 ErrorBoundary）。
 *
 * 捕获子树渲染异常 → 调用 fallback（函数式）展示降级 UI。
 * 开发环境额外打印 console.error 便于定位。
 */
class StubErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback({ error: this.state.error });
      }
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/** 初始化 Sentry（当前为 no-op，@sentry/react 未安装） */
export function initSentry(): void {
  // no-op
}

/** 捕获异常并上报（当前仅开发环境打印 console.error） */
export function captureException(error: unknown): void {
  if (import.meta.env.DEV) {
    console.error('[captureException]', error);
  }
}

/** Sentry 命名空间，对齐 @sentry/react 的 ErrorBoundary 用法 */
export const Sentry = { ErrorBoundary: StubErrorBoundary };
