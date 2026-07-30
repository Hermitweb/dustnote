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
            应用遇到了问题
          </h1>
          <p className="mb-4 text-center text-sm text-surface-muted">
            页面渲染时发生异常。你可以重新加载，或导出诊断信息反馈给开发者。
          </p>

          <div className="mb-4 rounded-lg bg-surface-bg p-3">
            <div className="mb-1 flex items-center justify-between text-xs text-surface-muted">
              <span>错误码</span>
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
              📋 导出诊断信息
            </button>
            <button
              onClick={this.handleReload}
              className="flex-1 rounded-lg bg-mint-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-mint-700"
            >
              🔄 重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }
}
