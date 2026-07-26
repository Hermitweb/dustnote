/**
 * 单机模式：解锁
 *
 * 调用 unlockLocalAuth 验证密码并解封 masterKey
 * 支持客户端锁定（连续 6 次失败后锁定 15 分钟）
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';

interface Props {
  onRecover: () => void;
}

export function StandaloneUnlockScreen({ onRecover }: Props) {
  const { t } = useTranslation();
  const unlockStandalone = useStore((s) => s.unlockStandalone);
  const getRemainingLockoutMs = useStore((s) => s.getRemainingLockoutMs);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingMs = getRemainingLockoutMs();
  const isLocked = remainingMs > 0;

  async function handleSubmit() {
    if (isLocked) return;
    setSubmitting(true);
    setError(null);
    try {
      await unlockStandalone(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-surface-bg p-6">
      <div className="w-full max-w-md rounded-2xl border border-surface-border bg-surface-card p-8 shadow-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-mint-100 text-3xl dark:bg-mint-900/30">
            🔓
          </div>
          <h1 className="text-2xl font-bold text-surface-fg">{t('auth.unlock_title')}</h1>
          <p className="mt-2 text-sm text-surface-muted">{t('auth.unlock_subtitle')}</p>
          <p className="mt-1 text-xs text-mint-600 dark:text-mint-400">
            {t('settings.app_mode_standalone')}
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
          className="space-y-4"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-fg">
              {t('auth.unlock_password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLocked}
              className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-500/20 disabled:opacity-50"
              autoComplete="off"
              autoFocus
            />
          </div>

          {isLocked && (
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
              账号已锁定，请 {Math.ceil(remainingMs / 1000)} 秒后重试
            </div>
          )}

          {error && !isLocked && (
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || isLocked || !password}
            className="w-full rounded-lg bg-mint-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-mint-700 disabled:opacity-50"
          >
            {submitting ? '...' : t('auth.unlock_btn')}
          </button>

          <button
            type="button"
            onClick={onRecover}
            className="w-full text-center text-xs text-surface-muted hover:text-mint-600"
          >
            {t('auth.unlock_recover')}
          </button>
        </form>
      </div>
    </div>
  );
}
