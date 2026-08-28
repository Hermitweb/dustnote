/**
 * 更新提示：L2 强提示 / L3 软提示
 *
 * L2: 建议尽快升级（发布超 14 天）
 * L3: 有新版本可用（发布未满 14 天）
 */

import type { CheckUpdateResult } from '@dustnote/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function UpdateBanner({ result }: { result: CheckUpdateResult }) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const url = result.updateUrl ?? result.manifest?.latest?.artifacts?.web?.url;
  if (!url) return null;

  const version = result.manifest?.latest?.version;
  const level = result.forceLevel;

  // 仅 L2（强提示）和 L3（软提示）显示 banner
  if (level !== 'L2_strong_prompt' && level !== 'L3_soft_prompt') return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 mx-auto max-w-2xl px-4">
      <div className="flex items-center gap-3 rounded-xl border border-surface-border bg-surface-card px-4 py-3 shadow-lg">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-mint-100 text-lg dark:bg-mint-900/30">
          ✨
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-surface-fg">
            {t('update.new_version', { version }) || `新版本 ${version} 可用`}
          </div>
          {level === 'L2_strong_prompt' && (
            <div className="text-xs text-slate-500">
              {t('update.suggest_upgrade') || '建议尽快升级以获得最佳体验'}
            </div>
          )}
          {level === 'L3_soft_prompt' && (
            <div className="text-xs text-slate-500">
              {t('update.available') || '有新版本可用，建议更新'}
            </div>
          )}
        </div>
        <a
          href={url}
          className="rounded-lg bg-mint-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-mint-700"
        >
          {t('update.now') || '立即更新'}
        </a>
        <button
          onClick={() => setDismissed(true)}
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
          aria-label={t('common.close') || '关闭'}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
