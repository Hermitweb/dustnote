/**
 * 单机模式：解锁
 *
 * 调用 unlockLocalAuth 验证密码并解封 masterKey
 * 支持客户端锁定（连续 6 次失败后锁定 15 分钟）
 * 支持桌面端宽限期免密解锁（仅 30 分钟内）
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { isTauri } from '../lib/platform';
import { graceRemainingSec } from '../lib/grace-unlock';
import { errorText } from '../lib/error-text';

interface Props {
  onRecover: () => void;
}

export function StandaloneUnlockScreen({ onRecover }: Props) {
  const { t } = useTranslation();
  const unlockStandalone = useStore((s) => s.unlockStandalone);
  const getRemainingLockoutMs = useStore((s) => s.getRemainingLockoutMs);
  const graceUnlock = useStore((s) => s.graceUnlock);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graceAvailable, setGraceAvailable] = useState(false);
  const [graceSec, setGraceSec] = useState(0);

  const remainingMs = getRemainingLockoutMs();
  const isLocked = remainingMs > 0;

  // 宽限期免密解锁：仅在桌面端启用
  useEffect(() => {
    if (!isTauri()) return;
    const check = () => {
      setGraceAvailable(useStore.getState().hasGraceUnlock());
      setGraceSec(graceRemainingSec());
    };
    check();
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, []);

  function handleGraceUnlock() {
    void graceUnlock().then((ok) => {
      if (!ok) setGraceAvailable(false);
    });
  }

  async function handleSubmit() {
    if (isLocked) return;
    setSubmitting(true);
    setError(null);
    try {
      await unlockStandalone(password);
    } catch (err) {
      setError(errorText(err));
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-surface-bg p-6">
      <div className="w-full max-w-md rounded-xl border border-surface-border bg-surface-card p-8 shadow-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft/60 text-3xl dark:bg-accent/30">
            🔓
          </div>
          <h1 className="text-2xl font-bold text-surface-fg">{t('auth.unlock_title')}</h1>
          <p className="mt-2 text-sm text-surface-muted">{t('auth.unlock_subtitle')}</p>
          <p className="mt-1 text-xs text-accent-text dark:text-accent-text">
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
          {graceAvailable && (
            <button
              type="button"
              onClick={handleGraceUnlock}
              className="w-full rounded-lg border border-accent bg-accent-soft/40 px-6 py-3 text-sm font-semibold text-accent-text transition-colors hover:bg-accent-soft/60 dark:bg-accent/20 dark:text-accent-text"
            >
              ⚡ {t('auth.grace_unlock')}（{Math.floor(graceSec / 60)}:
              {String(graceSec % 60).padStart(2, '0')}）
            </button>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-surface-fg">
              {t('auth.unlock_password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLocked}
              className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
              autoComplete="off"
              autoFocus
            />
          </div>

          {isLocked && (
            <div className="rounded-lg bg-danger-soft p-3 text-xs text-danger dark:bg-danger-soft dark:text-danger">
              {t('auth.locked_retry', { sec: Math.ceil(remainingMs / 1000) })}
            </div>
          )}

          {error && !isLocked && (
            <div className="rounded-lg bg-danger-soft p-3 text-xs text-danger dark:bg-danger-soft dark:text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || isLocked || !password}
            className="w-full rounded-lg bg-accent-strong px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-strong-hover disabled:opacity-50"
          >
            {submitting ? '...' : t('auth.unlock_btn')}
          </button>

          <button
            type="button"
            onClick={onRecover}
            className="w-full text-center text-xs text-surface-muted hover:text-accent-text"
          >
            {t('auth.unlock_recover')}
          </button>
        </form>
      </div>
    </div>
  );
}
