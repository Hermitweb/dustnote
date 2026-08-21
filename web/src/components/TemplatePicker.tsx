/**
 * 模板选择对话框
 *
 * 展示预设 + 自定义模板，点击后用模板内容创建新笔记。
 * 自定义模板支持删除（预设模板不可删）。
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import type { Template } from '@dustnote/shared';

interface TemplatePickerProps {
  onClose: () => void;
}

export function TemplatePicker({ onClose }: TemplatePickerProps) {
  const { t } = useTranslation();
  const templates = useStore((s) => s.templates);
  const createNoteFromTemplate = useStore((s) => s.createNoteFromTemplate);
  const deleteTemplate = useStore((s) => s.deleteTemplate);
  const selectedFolderId = useStore((s) => s.selectedFolderId);
  const mode = useStore((s) => s.mode);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets = templates.filter((t) => t.isPreset);
  const customs = templates.filter((t) => !t.isPreset);

  const handlePick = async (tpl: Template) => {
    setCreating(true);
    setError(null);
    try {
      await createNoteFromTemplate(tpl.id, selectedFolderId);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm(t('templates.confirm_delete'))) return;
    try {
      await deleteTemplate(id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-surface-fg">{t('templates.title')}</h2>
            <p className="text-xs text-surface-muted">{t('templates.subtitle')}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-surface-muted hover:bg-surface-bg hover:text-surface-fg"
            title={t('common.close')}
          >
            ✕
          </button>
        </div>

        {/* 模板列表 */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* 预设模板 */}
          <div className="mb-6">
            <h3 className="mb-3 text-xs font-semibold uppercase text-surface-muted">
              {t('templates.presets')}
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {presets.map((tpl) => (
                <button
                  key={tpl.id}
                  disabled={creating}
                  onClick={() => handlePick(tpl)}
                  className="group flex flex-col items-start rounded-xl border border-surface-border bg-surface-bg p-3 text-left transition-all hover:border-mint-400 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="mb-1 text-2xl">{tpl.icon}</span>
                  <span className="text-sm font-semibold text-surface-fg">{tpl.name}</span>
                  <span className="mt-0.5 line-clamp-2 text-xs text-surface-muted">
                    {tpl.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 自定义模板（仅联机模式） */}
          {mode === 'online' && (
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase text-surface-muted">
                {t('templates.custom')}
                <span className="ml-2 font-normal normal-case text-surface-muted">
                  ({customs.length})
                </span>
              </h3>
              {customs.length === 0 ? (
                <p className="rounded-lg border border-dashed border-surface-border p-4 text-center text-xs text-surface-muted">
                  {t('templates.custom_empty')}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {customs.map((tpl) => (
                    <div
                      key={tpl.id}
                      className="group relative flex flex-col items-start rounded-xl border border-surface-border bg-surface-bg p-3 text-left transition-all hover:border-mint-400 hover:shadow-md"
                    >
                      <button
                        disabled={creating}
                        onClick={() => handlePick(tpl)}
                        className="flex w-full flex-col items-start disabled:cursor-not-allowed"
                      >
                        <span className="mb-1 text-2xl">{tpl.icon}</span>
                        <span className="text-sm font-semibold text-surface-fg">{tpl.name}</span>
                        <span className="mt-0.5 line-clamp-2 text-xs text-surface-muted">
                          {tpl.description || t('templates.custom_desc')}
                        </span>
                      </button>
                      <button
                        onClick={(e) => handleDelete(e, tpl.id)}
                        className="absolute right-1 top-1 hidden rounded bg-red-50 p-1 text-xs text-red-600 hover:bg-red-100 group-hover:block dark:bg-red-900/30 dark:text-red-300"
                        title={t('common.delete')}
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部状态 */}
        {(creating || error) && (
          <div className="border-t border-surface-border px-6 py-3">
            {creating && <p className="text-xs text-surface-muted">{t('templates.creating')}</p>}
            {error && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {t('templates.error', { reason: error })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
