/**
 * 弹窗外壳（阶段 2.5 · docs/ui-optimization.md §2.5）
 *
 * 改造前 13 个弹窗各写一套外壳：遮罩有 black/40 与 black/50 两种、圆角有 rounded-lg
 * 与 rounded-2xl 两种、标题字号跟着感觉走、有的能内滚动有的一屏就顶到浏览器边框。
 * 这里把规格固定下来：
 *   遮罩  rgba(0,0,0,.55) + 轻微背景模糊
 *   面板  surface-2 底 + shadow-2xl + radius-xl + 最大高度 72vh 且内部滚动
 *   标题  20px / 600，右侧一个带无障碍名的关闭按钮
 * 玻璃档下面板的材质由 tokens.css 的 [role=dialog] 规则统一给，不在这里重复。
 *
 * z 层级用静态映射而不是模板字符串：Tailwind 只扫描源码里的完整类名，
 * 拼出来的 z-${n} 生成不出规则，表现就是"弹窗被别的浮层压住"且没人能看懂原因。
 */
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';

const Z: Record<number, string> = {
  40: 'z-40',
  50: 'z-50',
  60: 'z-[60]',
  70: 'z-[70]',
  90: 'z-[90]',
};

const SIZE: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  '2xl': 'max-w-3xl',
  '3xl': 'max-w-4xl',
};

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 面板最大宽度档，默认 md */
  size?: keyof typeof SIZE;
  /** 遮罩层级，默认 50 */
  z?: keyof typeof Z;
  /** start = 顶部对齐（命令面板 / 快速记录这类要贴着视线上沿的） */
  align?: 'center' | 'start';
  /** 点击遮罩是否关闭（含不可逆操作的弹窗应传 false） */
  dismissOnScrim?: boolean;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  size = 'md',
  z = 50,
  align = 'center',
  dismissOnScrim = true,
}: ModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 ${Z[z] ?? 'z-50'} flex justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-6 ${
        align === 'start' ? 'items-start pt-[12vh]' : 'items-center'
      }`}
      onClick={dismissOnScrim ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[72vh] w-full ${SIZE[size] ?? SIZE.md} flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-card shadow-2xl`}
      >
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-surface-border px-5 py-4">
          <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            title={t('common.close')}
            className="rounded p-1 text-text-tertiary transition-colors hover:bg-surface-3 hover:text-text-primary"
            type="button"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-surface-border px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default Modal;
