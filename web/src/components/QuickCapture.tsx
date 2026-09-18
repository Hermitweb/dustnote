/**
 * Quick Capture 快速捕获浮层（S-3 懒人化体验）
 *
 * 设计：
 * - 全局快捷键 Ctrl+Shift+N（桌面）/ Alt+N（Web）唤起
 * - 一个极简浮层：单行标题 + 多行正文 + 保存
 * - 保存即创建新笔记并选中，不干扰当前编辑流程
 * - ESC 关闭、Ctrl+Enter 保存
 *
 * 适用：临时灵感、剪贴板归档、快速记录
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';

export function QuickCapture({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const createNote = useStore((s) => s.createNote);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content]);

  async function save() {
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle && !trimmedContent) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const id = await createNote();
      await useStore.getState().updateNote(id, {
        title: trimmedTitle || t('quick_capture.default_title'),
        content: trimmedContent,
      });
      toast.success(t('quick_capture.saved'));
      onClose();
    } catch (err) {
      toast.error(t('quick_capture.save_fail', { reason: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-surface-border bg-surface-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('quick_capture.title_placeholder')}
          className="w-full border-b border-surface-border bg-transparent px-4 py-3 text-base font-semibold text-surface-fg placeholder-surface-muted focus:outline-none"
        />
        <textarea
          ref={contentRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t('quick_capture.content_placeholder')}
          rows={8}
          className="w-full resize-none bg-transparent px-4 py-3 font-mono text-sm text-surface-fg placeholder-surface-muted focus:outline-none"
        />
        <div className="flex items-center justify-between border-t border-surface-border bg-surface-bg px-4 py-2 text-xs text-surface-muted">
          <span>{t('quick_capture.hint')}</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded px-3 py-1.5 text-surface-muted hover:bg-surface-card"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="rounded bg-mint-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-mint-700 disabled:opacity-50"
            >
              {saving ? t('common.loading') : `⌘↵ ${t('common.save')}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
