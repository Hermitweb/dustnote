/**
 * 右键菜单项（从 Sidebar 提出，供导航轨与舞台列表共用）
 *
 * `k` 传 i18n key 时，图标由 Icon.tsx 的 LABEL_ICON 提供 —— 菜单文案里不再内嵌 emoji。
 */
import { useTranslation } from 'react-i18next';
import { IconText } from './Icon';

export function MenuItem({
  label,
  k,
  onClick,
  danger,
}: {
  /** 已翻译好的文案；传了 k 时可省略 */
  label?: string;
  /** i18n key：同时决定文案与图标 */
  k?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
        danger ? 'text-danger hover:bg-danger-soft' : 'text-surface-fg hover:bg-surface-bg'
      }`}
    >
      {k ? <IconText k={k} label={t(k)} /> : label}
    </button>
  );
}

export default MenuItem;
