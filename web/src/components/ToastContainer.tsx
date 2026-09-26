/**
 * Toast 容器：固定在右下角，自动堆叠，点击可提前关闭
 *
 * 无障碍：role="region" + aria-live="polite"，屏幕阅读器会朗读新出现的 toast。
 * 错误 toast 用 role="alert" 提高优先级。
 */

import { useTranslation } from 'react-i18next';
import { useToast, type ToastKind } from '../lib/toast';
import { Icon, type IconName } from './Icon';

/**
 * 三种 kind 的底色走引擎派生的「实心状态底」：白字必然 AA，且跟着主题变。
 * 改造前是 bg-emerald-600 / bg-red-600 / bg-slate-700 三个 Tailwind 硬色 ——
 * 它们既不吃主题，也没人验证过白字在暗色档够不够。
 */
const KIND_STYLES: Record<ToastKind, string> = {
  success: 'bg-success-solid text-on-success-solid',
  error: 'bg-danger-solid text-on-danger-solid',
  info: 'bg-info-solid text-on-info-solid',
};

/**
 * 每种 kind 的图标走图标体系（currentColor + 可控尺寸），而不是 ✓ ⚠ ℹ 文本符号：
 * 后者依赖字体是否有这些字形，且不吃颜色，暗色下会灰到看不见。
 * 文案里原先还各带一个 ✅/❌，等于两个图标叠着 —— 已在 i18n 侧剥掉。
 */
const KIND_ICONS: Record<ToastKind, IconName> = {
  success: 'check',
  error: 'warning',
  info: 'info',
};

export function ToastContainer() {
  const { t } = useTranslation();
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2"
      role="region"
      aria-label={t('common.notifications')}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg px-4 py-3 shadow-lg ${KIND_STYLES[t.kind]}`}
          onClick={() => dismiss(t.id)}
        >
          <Icon name={KIND_ICONS[t.kind]} size={16} className="mt-0.5 flex-shrink-0" />
          <span className="flex-1 text-sm">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
