/**
 * 样式化确认对话框 — 替换原生 confirm() 弹窗
 *
 * 原生 confirm() 在 Tauri 桌面端可能阻塞主线程或样式不一致，
 * 此组件提供统一的 modal 确认弹窗，支持异步确认。
 */

import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();

  // a11y + UX: Esc 关闭（与点击遮罩一致）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6"
      onClick={onCancel}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-surface-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-dialog-title" className="mb-2 text-sm font-semibold text-surface-fg">
          {title}
        </h3>
        <p className="mb-4 text-sm text-surface-muted">{message}</p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-surface-border px-4 py-2 text-sm text-surface-fg hover:bg-surface-bg"
          >
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors ${
              variant === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-mint-600 hover:bg-mint-700'
            }`}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
