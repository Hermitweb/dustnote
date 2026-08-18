import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isValidRecoveryCode } from '@dustnote/shared';
import { useStore } from '../lib/store';
import { isTauri } from '../lib/platform';
import { graceRemainingSec } from '../lib/grace-unlock';

export function UnlockScreen() {
  const { t } = useTranslation();
  const unlock = useStore((s) => s.unlock);
  const recover = useStore((s) => s.recover);
  const graceUnlock = useStore((s) => s.graceUnlock);
  const [mode, setMode] = useState<'unlock' | 'recover'>('unlock');
  const [password, setPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graceAvailable, setGraceAvailable] = useState(false);
  const [graceSec, setGraceSec] = useState(0);

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

  async function handleUnlock() {
    if (!password) return;
    setSubmitting(true);
    setError(null);
    try {
      await unlock(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecover() {
    if (!isValidRecoveryCode(recoveryCode) || newPassword.length < 8) return;
    setSubmitting(true);
    setError(null);
    try {
      await recover(recoveryCode, newPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
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
          {mode === 'unlock' ? (
            <>
              <h1 className="text-2xl font-bold text-surface-fg">{t('auth.unlock_title')}</h1>
              <p className="mt-2 text-sm text-surface-muted">{t('auth.unlock_subtitle')}</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-surface-fg">{t('auth.recover_title')}</h1>
              <p className="mt-2 text-sm text-surface-muted">{t('auth.recover_subtitle')}</p>
            </>
          )}
        </div>

        {mode === 'unlock' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleUnlock();
            }}
            className="space-y-4"
          >
            {graceAvailable && (
              <button
                type="button"
                onClick={handleGraceUnlock}
                className="w-full rounded-lg border border-mint-500 bg-mint-50 px-6 py-3 text-sm font-semibold text-mint-700 transition-colors hover:bg-mint-100 dark:bg-mint-900/20 dark:text-mint-300"
              >
                ⚡ {t('auth.grace_unlock')}（{Math.floor(graceSec / 60)}:{String(graceSec % 60).padStart(2, '0')}）
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
                autoFocus
                className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-500/20"
                autoComplete="current-password"
              />
            </div>
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={!password || submitting}
              className="w-full rounded-lg bg-mint-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-mint-700 disabled:opacity-50"
            >
              {submitting ? '...' : t('auth.unlock_btn')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('recover');
                setError(null);
              }}
              className="w-full text-xs text-surface-muted hover:text-surface-fg"
            >
              {t('auth.unlock_recover')}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleRecover();
            }}
            className="space-y-4"
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-surface-fg">
                {t('auth.recover_code')}
              </label>
              <input
                type="text"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value.slice(0, 16))}
                autoFocus
                autoCapitalize="characters"
                placeholder="A7K2M-9PQR3"
                spellCheck={false}
                className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-center font-mono text-2xl tracking-widest focus:border-mint-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-surface-fg">
                {t('auth.recover_new_password')}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm"
              />
            </div>
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={!isValidRecoveryCode(recoveryCode) || newPassword.length < 8 || submitting}
              className="w-full rounded-lg bg-mint-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-mint-700 disabled:opacity-50"
            >
              {submitting ? '...' : t('auth.recover_btn')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('unlock');
                setError(null);
              }}
              className="w-full text-xs text-surface-muted hover:text-surface-fg"
            >
              {t('auth.back_to_unlock')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
