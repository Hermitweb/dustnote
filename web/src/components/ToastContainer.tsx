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
      className="pointer-events-none fixed bottom-4 right-4 z-toast flex flex-col gap-2"
      role="region"
      aria-label={t('common.notifications')}
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          role={item.kind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`toast-in pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg px-4 py-3 shadow-lg ${KIND_STYLES[item.kind]}`}
        >
          <Icon name={KIND_ICONS[item.kind]} size={16} className="mt-0.5 flex-shrink-0" />
          <span className="flex-1 text-sm">{item.message}</span>
          {/*
            关闭键必须是真按钮：原先整块 div 挂 onClick，键盘 Tab 到不了、读屏也
            不会播报"可关闭"。形参改名 item 是因为组件顶部已有 useTranslation 的 t，
            写 t('common.close') 会调到 toast 对象上（运行时才炸的那种）。
          */}
          <button
            type="button"
            onClick={() => dismiss(item.id)}
            aria-label={t('common.close')}
            className="-mr-1 -mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded opacity-70 transition-opacity hover:opacity-100"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
