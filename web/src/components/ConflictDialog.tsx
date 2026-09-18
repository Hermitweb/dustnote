/**
 * 同步冲突裁决对话框（v2.5.5 新增）
 *
 * 当离线队列重放遇到 409 且字段级合并产生歧义时，冲突被推入 store 的
 * pendingConflicts。本组件读取该列表，逐条展示字段级 diff，让用户选择：
 * - 保留我的编辑（local）
 * - 保留服务器版本（server）
 * - 智能合并（merged，冲突字段优先本地，其余保留对端）
 * - 忽略（保留当前暂存态，不 re-PATCH）
 *
 * 每次只展示一个冲突（队首），解决/忽略后自动切换到下一个。
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import type { FieldConflict } from '@dustnote/client-core';

/** 字段名 → i18n key 映射 */
const FIELD_LABEL_KEY: Record<string, string> = {
  title: 'conflict.field_title',
  content: 'conflict.field_content',
  tags: 'conflict.field_tags',
  isPinned: 'conflict.field_isPinned',
  isFavorite: 'conflict.field_isFavorite',
  folderId: 'conflict.field_folderId',
  deletedAt: 'conflict.field_deletedAt',
};

/** 把字段值格式化成可读文本（用于 diff 展示） */
function formatValue(field: string, value: unknown, t: (k: string) => string): string {
  if (value === null || value === undefined) return t('conflict.none_value');

  switch (field) {
    case 'title':
      return String(value) || t('conflict.none_value');
    case 'content': {
      const s = String(value);
      return s.length > 120 ? `${s.slice(0, 120)}…` : s || t('conflict.none_value');
    }
    case 'tags':
      return Array.isArray(value) && value.length > 0
        ? (value as string[]).join('、')
        : t('conflict.none_value');
    case 'isPinned':
      return value ? t('conflict.pinned') : t('conflict.unpinned');
    case 'isFavorite':
      return value ? t('conflict.favorited') : t('conflict.unfavorited');
    case 'folderId':
      return String(value) || t('conflict.none_value');
    case 'deletedAt':
      return value !== null && value !== undefined && String(value)
        ? t('conflict.deleted')
        : t('conflict.not_deleted');
    default:
      return String(value);
  }
}

export function ConflictDialog() {
  const { t } = useTranslation();
  const pendingConflicts = useStore((s) => s.pendingConflicts);
  const resolveConflictChoice = useStore((s) => s.resolveConflictChoice);
  const dismissConflict = useStore((s) => s.dismissConflict);
  const [resolving, setResolving] = useState<string | null>(null);

  if (pendingConflicts.length === 0) return null;

  const conflict = pendingConflicts[0];
  if (!conflict) return null;

  const handleChoice = async (choice: 'local' | 'server' | 'merged') => {
    setResolving(choice);
    try {
      await resolveConflictChoice(conflict.noteId, choice);
    } catch {
      // 解决失败（如 re-PATCH 网络错误）：保留在 pendingConflicts，用户可重试
    } finally {
      setResolving(null);
    }
  };

  const fieldLabel = (field: string) => t(FIELD_LABEL_KEY[field] ?? field);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="conflict-dialog-title"
    >
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-surface-card p-5 shadow-2xl">
        <h3 id="conflict-dialog-title" className="mb-1 text-base font-semibold text-surface-fg">
          {t('conflict.title')}
        </h3>
        <p className="mb-4 text-sm text-surface-muted">{t('conflict.subtitle')}</p>

        {/* 字段级 diff 列表 */}
        <div className="mb-4 space-y-3">
          {conflict.conflicts.map((c: FieldConflict, i: number) => (
            <div
              key={`${c.field}-${i}`}
              className="rounded-xl border border-surface-border bg-surface-bg p-3"
            >
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-muted">
                {fieldLabel(c.field)}
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex gap-2">
                  <span className="w-20 shrink-0 text-xs text-surface-muted">
                    {t('conflict.my_version')}
                  </span>
                  <span className="flex-1 break-words rounded bg-mint-100/70 px-2 py-1 text-surface-fg dark:bg-mint-900/20">
                    {formatValue(c.field, c.localValue, t)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="w-20 shrink-0 text-xs text-surface-muted">
                    {t('conflict.server_version')}
                  </span>
                  <span className="flex-1 break-words rounded bg-surface-card px-2 py-1 text-surface-fg ring-1 ring-surface-border">
                    {formatValue(c.field, c.serverValue, t)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => void handleChoice('local')}
              disabled={resolving !== null}
              className="flex-1 rounded-lg bg-mint-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-mint-700 disabled:opacity-50"
            >
              {resolving === 'local' ? t('conflict.resolving') : t('conflict.use_local')}
            </button>
            <button
              onClick={() => void handleChoice('server')}
              disabled={resolving !== null}
              className="flex-1 rounded-lg border border-surface-border px-4 py-2.5 text-sm font-medium text-surface-fg hover:bg-surface-bg disabled:opacity-50"
            >
              {resolving === 'server' ? t('conflict.resolving') : t('conflict.use_server')}
            </button>
          </div>
          <button
            onClick={() => void handleChoice('merged')}
            disabled={resolving !== null}
            className="w-full rounded-lg border border-mint-400 px-4 py-2.5 text-sm font-medium text-mint-700 hover:bg-mint-50 disabled:opacity-50 dark:text-mint-300 dark:hover:bg-mint-900/20"
          >
            {resolving === 'merged'
              ? t('conflict.resolving')
              : `${t('conflict.use_merged')} · ${t('conflict.merged_hint')}`}
          </button>
          <button
            onClick={() => dismissConflict(conflict.noteId)}
            disabled={resolving !== null}
            className="w-full rounded-lg px-4 py-2 text-sm text-surface-muted hover:text-surface-fg disabled:opacity-50"
          >
            {t('conflict.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}
