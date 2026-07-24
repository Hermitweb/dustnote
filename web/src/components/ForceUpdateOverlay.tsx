/**
 * 强制升级遮罩：L0 / L1 时显示
 */

import type { CheckUpdateResult } from '@dustnote/shared';

export function ForceUpdateOverlay({ result }: { result: CheckUpdateResult }) {
  const url = result.updateUrl ?? 'https://dustnote.app/download';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/95 px-6">
      <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl dark:bg-slate-800">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-mint-100 text-3xl dark:bg-mint-900/30">
          🔄
        </div>
        <h1 className="mb-2 text-xl font-bold text-slate-900 dark:text-slate-50">需要升级</h1>
        <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
          {result.message ?? '当前版本已停止支持，请升级到最新版本后继续使用。'}
        </p>
        <a
          href={url}
          className="inline-flex w-full items-center justify-center rounded-lg bg-mint-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-mint-700"
        >
          立即升级
        </a>
        <p className="mt-4 text-xs text-slate-400">升级后请刷新页面</p>
      </div>
    </div>
  );
}
