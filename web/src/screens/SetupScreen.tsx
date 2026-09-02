import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter';

export function SetupScreen() {
  const { t } = useTranslation();
  const setup = useStore((s) => s.setup);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const tooWeak = password.length > 0 && password.length < 6;
  const mismatch = confirm.length > 0 && password !== confirm;

  async function handleSubmit() {
    if (password.length < 6) {
      setError(t('auth.too_weak'));
      return;
    }
    if (password !== confirm) {
      setError(t('auth.mismatch'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const code = await setup(password);
      setRecoveryCode(code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
    } finally {
      setSubmitting(false);
    }
  }

  if (recoveryCode) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-bg p-6">
        <div className="w-full max-w-md rounded-2xl border border-surface-border bg-surface-card p-8 text-center shadow-xl">
          <div className="mb-4 text-5xl">🔐</div>
          <h1 className="mb-2 text-xl font-bold text-surface-fg">
            {t('auth.recovery_code_label')}
          </h1>
          <div className="my-6 rounded-xl bg-mint-50 p-6 font-mono text-3xl font-bold tracking-widest text-mint-700 dark:bg-mint-900/30 dark:text-mint-300">
            {recoveryCode}
          </div>
          <p className="mb-6 text-xs text-surface-muted">{t('auth.no_recovery_warning')}</p>
          <button
            onClick={() => {
              /* 自动跳转主界面 */
              window.location.reload();
            }}
            className="w-full rounded-lg bg-mint-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-mint-700"
          >
            {t('auth.recovery_code_done')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-surface-bg p-6">
      <div className="w-full max-w-md rounded-2xl border border-surface-border bg-surface-card p-8 shadow-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-mint-100 dark:bg-mint-900/30">
            <img src="/logo.png" alt="" className="h-10 w-10" />
          </div>
          <h1 className="text-2xl font-bold text-surface-fg">{t('auth.setup_title')}</h1>
          <p className="mt-2 text-sm text-surface-muted">{t('auth.setup_subtitle')}</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
          className="space-y-4"
        >
          <Field
            label={t('auth.setup_password')}
            type="password"
            value={password}
            onChange={setPassword}
            hint={t('auth.setup_password_hint')}
            error={tooWeak ? t('auth.too_weak') : undefined}
          />
          <PasswordStrengthMeter password={password} />
          <Field
            label={t('auth.setup_password_confirm')}
            type="password"
            value={confirm}
            onChange={setConfirm}
            error={mismatch ? t('auth.mismatch') : undefined}
          />

          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}

          <p className="text-xs text-surface-muted">{t('auth.setup_recovery_hint')}</p>

          <button
            type="submit"
            disabled={submitting || password.length < 6 || password !== confirm}
            className="w-full rounded-lg bg-mint-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-mint-700 disabled:opacity-50"
          >
            {submitting ? '...' : t('auth.setup_btn')}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  hint,
  error,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string | undefined;
  error?: string | undefined;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-surface-fg">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-500/20"
        autoComplete="off"
      />
      {hint && !error && <p className="mt-1 text-xs text-surface-muted">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
