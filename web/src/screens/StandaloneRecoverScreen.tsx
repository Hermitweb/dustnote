/**
 * 单机模式：恢复码重置密码
 *
 * 调用 recoverLocalAuth 用恢复码解封原始 masterKey，
 * 然后用新密码重新包装 masterKey（masterKey 不变，已有笔记可继续解密）
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isValidRecoveryCode } from '@dustnote/shared';
import { useStore } from '../lib/store';

interface Props {
  onBack: () => void;
}

export function StandaloneRecoverScreen({ onBack }: Props) {
  const { t } = useTranslation();
  const recoverStandalone = useStore((s) => s.recoverStandalone);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooWeak = newPassword.length > 0 && newPassword.length < 6;
  const mismatch = confirm.length > 0 && newPassword !== confirm;

  async function handleSubmit() {
    if (!isValidRecoveryCode(recoveryCode)) {
      setError(t('auth.recover_code_invalid'));
      return;
    }
    if (newPassword.length < 6) {
      setError(t('auth.too_weak'));
      return;
    }
    if (newPassword !== confirm) {
      setError(t('auth.mismatch'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await recoverStandalone(recoveryCode, newPassword);
      // 成功后会自动解锁，不需要显示恢复码
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
            🔑
          </div>
          <h1 className="text-2xl font-bold text-surface-fg">{t('auth.recover_title')}</h1>
          <p className="mt-2 text-sm text-surface-muted">
            {t('auth.recover_standalone_subtitle')}
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
              {t('auth.recover_code')}
            </label>
            <input
              type="text"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value.slice(0, 16))}
              placeholder="A7K2M-9PQR3"
              autoCapitalize="characters"
              spellCheck={false}
              className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-center font-mono text-lg tracking-widest focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-500/20"
              autoComplete="off"
              autoFocus
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
              className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-500/20"
              autoComplete="off"
            />
            {tooWeak && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{t('auth.too_weak')}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-surface-fg">
              {t('auth.setup_password_confirm')}
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-500/20"
              autoComplete="off"
            />
            {mismatch && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{t('auth.mismatch')}</p>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={
              submitting ||
              !isValidRecoveryCode(recoveryCode) ||
              newPassword.length < 6 ||
              newPassword !== confirm
            }
            className="w-full rounded-lg bg-mint-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-mint-700 disabled:opacity-50"
          >
            {submitting ? '...' : t('auth.recover_btn')}
          </button>

          <button
            type="button"
            onClick={onBack}
            className="w-full text-center text-xs text-surface-muted hover:text-mint-600"
          >
            {t('auth.back_to_unlock')}
          </button>
        </form>
      </div>
    </div>
  );
}
