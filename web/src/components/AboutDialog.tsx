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

        {/* GitHub 项目链接 */}
        <a
          href="https://github.com/Hermitweb/dustnote"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-surface-border bg-surface-bg px-4 py-2.5 text-sm font-medium text-surface-fg transition-colors hover:bg-surface-border"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          GitHub 项目主页
        </a>

        <button
          onClick={onClose}
          className="mt-3 w-full rounded-lg bg-mint-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-mint-700"
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
