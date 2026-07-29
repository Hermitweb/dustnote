/**
 * Toast 容器：固定在右下角，自动堆叠，点击可提前关闭
 *
 * 无障碍：role="region" + aria-live="polite"，屏幕阅读器会朗读新出现的 toast。
 * 错误 toast 用 role="alert" 提高优先级。
 */

import { useToast, type ToastKind } from '../lib/toast';

const KIND_STYLES: Record<ToastKind, string> = {
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
  info: 'bg-slate-700 text-white dark:bg-slate-800',
};

const KIND_ICONS: Record<ToastKind, string> = {
  success: '✓',
  error: '⚠',
  info: 'ℹ',
};

export function ToastContainer() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2"
      role="region"
      aria-label="通知"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg px-4 py-3 shadow-lg ${KIND_STYLES[t.kind]}`}
          onClick={() => dismiss(t.id)}
        >
          <span className="flex-shrink-0 font-bold">{KIND_ICONS[t.kind]}</span>
          <span className="flex-1 text-sm">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
