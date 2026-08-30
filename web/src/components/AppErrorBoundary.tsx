/**
 * 全局错误边界
 *
 * 捕获 React 渲染异常，避免白屏。
 * 显示错误码 + 一键复制诊断信息按钮，让用户能提供可定位的证据。
 *
 * 防坑：JS 异常导致白屏是用户体验最差的情况，
 * 用户只看到空白页面，既无法操作也无法报告。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '../lib/diagnostics';
import i18n from '../lib/i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** 用户可见的错误码（短，便于口头报告） */
  errorCode: string;
}

/** 生成 6 位错误码（便于用户口头报告，开发者可据此在诊断日志中定位） */
function genErrorCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorCode: '' };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      errorCode: genErrorCode(),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    void logger.error('error-boundary', error.message, {
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  handleReload = (): void => {
    location.reload();
  };

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  handleCopyDiagnostics = async (): Promise<void> => {
    try {
      const { exportDiagnostics } = await import('../lib/diagnostics');
      await exportDiagnostics();
    } catch (e) {
      console.error('导出诊断失败', e);
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const { error, errorCode } = this.state;
    return (
      <div className="flex h-full items-center justify-center bg-surface-bg p-6">
        <div className="w-full max-w-lg rounded-2xl border border-surface-border bg-surface-card p-8 shadow-xl">
          <div className="mb-4 text-center text-5xl">💔</div>
          <h1 className="mb-2 text-center text-xl font-bold text-surface-fg">
            {i18n.t('error_boundary.title')}
          </h1>
          <p className="mb-4 text-center text-sm text-surface-muted">
            {i18n.t('error_boundary.description')}
          </p>

          <div className="mb-4 rounded-lg bg-surface-bg p-3">
            <div className="mb-1 flex items-center justify-between text-xs text-surface-muted">
              <span>{i18n.t('error_boundary.error_code')}</span>
              <code className="rounded bg-mint-100 px-2 py-0.5 font-mono font-bold text-mint-700 dark:bg-mint-900/30 dark:text-mint-300">
                {errorCode}
              </code>
            </div>
            {error && (
              <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs text-red-600 dark:text-red-400">
                {error.message}
              </pre>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={this.handleCopyDiagnostics}
              className="flex-1 rounded-lg border border-surface-border px-4 py-2.5 text-sm font-medium text-surface-fg hover:bg-surface-bg"
            >
              {i18n.t('error_boundary.export_diagnostics')}
            </button>
            <button
              onClick={this.handleRetry}
              className="flex-1 rounded-lg border border-surface-border px-4 py-2.5 text-sm font-medium text-surface-fg hover:bg-surface-bg"
            >
              {i18n.t('error_boundary.retry')}
            </button>
            <button
              onClick={this.handleReload}
              className="flex-1 rounded-lg bg-mint-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-mint-700"
            >
              {i18n.t('error_boundary.reload')}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
