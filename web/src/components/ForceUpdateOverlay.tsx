/**
 * 强制升级遮罩：L0 / L1 时显示
 */

import type { CheckUpdateResult } from '@dustnote/shared';
import { useTranslation } from 'react-i18next';
import { CARD_BTN_PRIMARY, StatePlate } from './StatePlate';

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
      <div className="max-w-md rounded-xl bg-surface-card p-8 shadow-2xl">
        <StatePlate
          size="card"
          icon="refresh"
          tone="guide"
          title={t('settings.force_update_title')}
          hint={result.message ?? t('update.stopped_support')}
          detail={t('settings.force_update_hint')}
          actions={
            url ? (
              <a href={url} className={CARD_BTN_PRIMARY}>
                {t('settings.download')}
              </a>
            ) : null
          }
        />
      </div>
    </div>
  );
}
