/**
 * 顶栏常驻标题："我现在在哪个作用域"
 *
 * 单独一个组件而不是在 App 里订阅 store：viewMode / selectedFolderId 每次点击都会变，
 * 挂在 App 上等于整棵子树跟着重渲染。让它自己订阅，重渲染范围就只有这一行文字。
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { scopeLabel } from '../lib/scope-label';

export function ScopeTitle() {
  const { t } = useTranslation();
  const viewMode = useStore((s) => s.viewMode);
  const selectedFolderId = useStore((s) => s.selectedFolderId);
  const folders = useStore((s) => s.folders);

  const folderNames = useMemo(
    () => Object.fromEntries(folders.map((f) => [f.id, f.name])),
    [folders]
  );
  const label = scopeLabel(
    { viewMode, selectedFolderId, folderNames },
    {
      overview: t('sidebar.overview'),
      all: t('sidebar.all'),
      favorites: t('sidebar.favorites'),
      trash: t('sidebar.trash'),
      unfiled: t('editor.unfiled'),
    }
  );

  return (
    <div
      /* 切作用域时播报一次：图标轨档下这是唯一能"读到"位置的地方 */
      aria-live="polite"
      className="min-w-0 flex-1 truncate text-sm font-medium text-surface-fg"
      data-scope-title=""
    >
      {label}
    </div>
  );
}

export default ScopeTitle;
