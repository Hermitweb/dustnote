/**
 * 强制升级遮罩：L0 / L1 时显示
 */

import type { CheckUpdateResult } from '@dustnote/shared';
import { useTranslation } from 'react-i18next';

export function ForceUpdateOverlay({ result }: { result: CheckUpdateResult }) {
  const { t } = useTranslation();
  /*
   * 升级出口：优先服务端算出的 updateUrl（downloadPageUrl ?? webOrigin），
   * 没有就退回本机 origin —— Web 端与 /downloads/ 同源，这个兜底永远指向真实服务。
   * 曾经这里写死 'https://dustnote.app/download'：一个无真实服务的占位域名，
   * 强制升级时把用户送去死站（审计 LIFE-008/009 同一批，此前只改了服务端两处）。
   */
  const sameOrigin =
    typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)
      ? window.location.origin
      : null;
  const url = result.updateUrl ?? sameOrigin;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/95 px-6">
      <div className="max-w-md rounded-xl bg-surface-card p-8 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft/60 text-3xl dark:bg-accent/30">
          🔄
        </div>
        <h1 className="mb-2 text-xl font-bold text-text-primary dark:text-text-primary">
          {t('settings.force_update_title')}
        </h1>
        <p className="mb-6 text-sm text-text-secondary dark:text-text-tertiary">
          {result.message ?? t('update.stopped_support')}
        </p>
        {url && (
          <a
            href={url}
            className="inline-flex w-full items-center justify-center rounded-lg bg-accent-strong px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-strong-hover"
          >
            {t('settings.download')}
          </a>
        )}
        <p className="mt-4 text-xs text-text-secondary">{t('settings.force_update_hint')}</p>
      </div>
    </div>
  );
}
