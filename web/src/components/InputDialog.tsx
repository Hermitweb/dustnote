/**
 * 样式化输入对话框 — 替换原生 prompt()
 *
 * 原生 prompt() 与 alert()/confirm() 同源的问题：Tauri 桌面端会阻塞主线程
 * 导致界面卡死无法关闭（AboutDialog / ConfirmDialog 头注释记录的同款事故）。
 * Editor「另存为模板」此前漏网用的就是 prompt()。
 *
 * 交互对齐 Sidebar 的内联重命名弹窗：autoFocus、Enter 确认、Esc 取消、
 * 点遮罩关闭。空输入时确认按钮禁用（与 prompt 的「空串取消」语义一致）。
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  title: string;
  /** 输入框初始值 */
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** 提交回调；空串/纯空白不会触发 */
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function InputDialog({
  title,
  initialValue = '',
  placeholder,
  confirmLabel,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-nested flex items-center justify-center scrim p-4 backdrop-blur-[2px] sm:p-6"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-surface-card p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold text-surface-fg">{title}</h3>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && trimmed) onConfirm(trimmed);
          }}
          className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-surface-fg focus:border-accent"
        />
        <div className="mt-3 flex gap-2">
          <button
            disabled={!trimmed}
            onClick={() => onConfirm(trimmed)}
            className="flex-1 rounded-lg bg-accent-strong px-3 py-2 text-sm font-semibold text-accent-strong-on hover:bg-accent-strong-hover disabled:opacity-50"
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-surface-border px-3 py-2 text-sm text-surface-fg hover:bg-surface-bg"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
