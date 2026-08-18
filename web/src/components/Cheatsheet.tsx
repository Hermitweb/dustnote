/**
 * 键盘快捷键速查表面板
 *
 * 按 F1 唤起 / 关闭；Esc 关闭。
 * 仅在主界面（unlocked 状态）挂载，因此监听器天然只在登录后生效。
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '../lib/platform';

interface ShortcutItem {
  /** 展示用的按键组合，如 'Ctrl+N' */
  keys: string;
  /** i18n key，位于 cheatsheet 命名空间 */
  labelKey: string;
  /** 是否仅桌面端可用（web 端会标注提示） */
  desktopOnly?: boolean;
}

const SHORTCUTS: ShortcutItem[] = [
  { keys: 'Ctrl+N', labelKey: 'cheatsheet.new_note', desktopOnly: true },
  { keys: 'Ctrl+S', labelKey: 'cheatsheet.save', desktopOnly: true },
  { keys: 'Ctrl+F', labelKey: 'cheatsheet.search' },
  { keys: 'Ctrl+B', labelKey: 'cheatsheet.toggle_sidebar' },
  { keys: 'Ctrl+,', labelKey: 'cheatsheet.open_settings' },
  { keys: 'Ctrl+L', labelKey: 'cheatsheet.lock' },
];

export function Cheatsheet() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const desktop = isTauri();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    // capture 阶段拦截，优先于浏览器原生 F1 帮助
    window.addEventListener('keydown', onKey, { capture: true });
    return () =>
      window.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-surface-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-surface-fg">{t('cheatsheet.title')}</h2>
          <button
            onClick={() => setOpen(false)}
            className="text-surface-muted hover:text-surface-fg"
            title={t('cheatsheet.close')}
          >
            ✕
          </button>
        </div>

        <div className="space-y-2">
          {SHORTCUTS.map((s) => (
            <div
              key={s.keys}
              className="flex items-center justify-between rounded-lg border border-surface-border px-3 py-2"
            >
              <span className="text-sm text-surface-fg">
                {t(s.labelKey)}
                {s.desktopOnly && !desktop && (
                  <span className="ml-2 text-xs text-surface-muted">
                    ({t('cheatsheet.desktop_only')})
                  </span>
                )}
              </span>
              <kbd className="rounded bg-surface-bg px-2 py-1 font-mono text-xs text-surface-fg">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>

        <p className="mt-4 text-center text-xs text-surface-muted">{t('cheatsheet.hint')}</p>
      </div>
    </div>
  );
}
