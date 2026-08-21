/**
 * 密码强度实时反馈条
 *
 * 输入时显示 0~4 级强度条 + 文案。空输入不渲染。
 */

import { useTranslation } from 'react-i18next';
import { evalPasswordStrength, STRENGTH_LABELS, STRENGTH_COLORS } from '../lib/password-strength';

export function PasswordStrengthMeter({ password }: { password: string }) {
  const { t } = useTranslation();
  if (!password) return null;

  const strength = evalPasswordStrength(password);
  const label = t(STRENGTH_LABELS[strength]);
  const color = STRENGTH_COLORS[strength];

  return (
    <div
      className="mt-1"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={4}
      aria-valuenow={strength}
      aria-label={label}
    >
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${i <= strength ? color : 'bg-surface-border'}`}
          />
        ))}
      </div>
      <div className="mt-1 text-xs text-surface-muted">{label}</div>
    </div>
  );
}
