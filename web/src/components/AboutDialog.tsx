/**
 * 关于弹窗 — 替换原生 alert()
 *
 * 原生 alert() 在 Tauri 桌面端会阻塞主线程导致界面卡死无法关闭。
 * 此组件提供样式化的关于信息 modal，支持 Esc / 点击遮罩关闭。
 */

import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';

interface Props {
  onClose: () => void;
}

export function AboutDialog({ onClose }: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-dialog-title"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-surface-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-mint-100 text-3xl dark:bg-mint-900/30">
            🌿
          </div>
          <h2 id="about-dialog-title" className="text-lg font-bold text-surface-fg">
            {t('app.name')}
          </h2>
          <p className="mt-1 text-xs text-surface-muted">{t('app.tagline')}</p>
        </div>

        <div className="space-y-2 rounded-lg border border-surface-border bg-surface-bg p-3 text-center">
          <div className="text-sm text-surface-fg">{t('settings.about_line')}</div>
          <div className="font-mono text-xs text-surface-muted">
            {t('settings.version')}: {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}
          </div>
          <div className="text-xs text-surface-muted">{t('settings.tech_stack')}</div>
          <div className="pt-1 text-xs text-surface-muted">© 2026 DustNote Team</div>
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full rounded-lg bg-mint-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-mint-700"
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
