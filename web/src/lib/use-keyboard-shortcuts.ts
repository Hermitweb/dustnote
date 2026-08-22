/**
 * 应用内快捷键 hook
 *
 * 在 App 顶层挂载，集中注册所有快捷键。
 * 仅在 authState === 'unlocked' 时生效。
 *
 * 桌面端独占快捷键（Ctrl+N/S）在 web 端跳过，让浏览器原生行为生效。
 * 同时监听 Tauri 菜单事件 menu://action，复用同一组 action。
 */

import { useEffect } from 'react';
import { useStore } from './store';
import { isTauri } from './platform';
import type { AuthState } from './store';

/** 判断事件目标是否在输入框中 */
function isInInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

/** 快捷键定义 */
interface ShortcutDef {
  /** 拼接后的键序列，如 'ctrl+n' */
  key: string;
  /** 是否仅桌面端可用（web 端跳过执行，不 preventDefault） */
  desktopOnly?: boolean;
  /** 是否允许在输入框中触发 */
  allowInInput?: boolean;
  /** 执行动作 */
  action: () => void;
}

/** 构建快捷键映射表 */
function buildShortcuts(authState: AuthState): ShortcutDef[] {
  if (authState !== 'unlocked') return [];

  return [
    {
      key: 'ctrl+n',
      desktopOnly: true,
      action: () => {
        void useStore.getState().createNote();
      },
    },
    {
      key: 'ctrl+shift+n',
      desktopOnly: true,
      action: () => {
        window.dispatchEvent(new CustomEvent('app:quick-capture'));
      },
    },
    {
      key: 'ctrl+s',
      desktopOnly: true,
      action: () => {
        window.dispatchEvent(new CustomEvent('editor:save-now'));
      },
    },
    {
      key: 'ctrl+f',
      action: () => {
        useStore.getState().focusSearch();
      },
    },
    {
      key: 'ctrl+b',
      action: () => {
        useStore.getState().toggleSidebar();
      },
    },
    {
      key: 'ctrl+,',
      action: () => {
        window.dispatchEvent(new CustomEvent('app:open-settings'));
      },
    },
    {
      key: 'ctrl+l',
      action: () => {
        useStore.getState().lock();
      },
    },
    {
      key: 'ctrl+k',
      allowInInput: true,
      action: () => {
        window.dispatchEvent(new CustomEvent('app:toggle-command-palette'));
      },
    },
  ];
}

/** 处理单个快捷键事件 */
function handleShortcut(def: ShortcutDef, e: KeyboardEvent): void {
  if (def.desktopOnly && !isTauri()) return;
  if (!def.allowInInput && isInInput(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
  def.action();
}

export function useKeyboardShortcuts(authState: AuthState): void {
  const desktop = isTauri();

  useEffect(() => {
    const shortcuts = buildShortcuts(authState);

    const onKeyDown = (e: KeyboardEvent) => {
      // 某些浏览器插件会派发无 key 属性的合成 KeyboardEvent，直接防御
      const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
      if (!key) return;
      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push('ctrl');
      if (e.shiftKey) parts.push('shift');
      if (e.altKey) parts.push('alt');
      parts.push(key);
      const combo = parts.join('+');

      for (const def of shortcuts) {
        if (def.key === combo) {
          handleShortcut(def, e);
          return;
        }
      }

      // 桌面端：拦截浏览器默认快捷键（Ctrl+O 打开文件、Ctrl+P 打印）
      if (desktop && (e.ctrlKey || e.metaKey) && ['o', 'p'].includes(key)) {
        e.preventDefault();
      }
    };

    // capture 阶段拦截，优先于 React 合成事件
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () =>
      window.removeEventListener('keydown', onKeyDown, { capture: true } as EventListenerOptions);
  }, [authState, desktop]);

  // 监听 Tauri 菜单事件（仅桌面端）
  useEffect(() => {
    if (!desktop) return;

    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<string>('menu://action', (event) => {
          const id = event.payload;
          switch (id) {
            case 'file_new_note':
              if (authState === 'unlocked') {
                void useStore.getState().createNote();
              }
              break;
            case 'view_toggle_sidebar':
              useStore.getState().toggleSidebar();
              break;
            case 'view_zoom_in': {
              const current = parseFloat(getComputedStyle(document.documentElement).zoom || '1');
              document.documentElement.style.zoom = String(Math.min(current + 0.1, 2.0));
              break;
            }
            case 'view_zoom_out': {
              const current = parseFloat(getComputedStyle(document.documentElement).zoom || '1');
              document.documentElement.style.zoom = String(Math.max(current - 0.1, 0.5));
              break;
            }
            case 'view_zoom_reset':
              document.documentElement.style.zoom = '1';
              break;
            case 'help_about':
              // 触发自定义事件，由 App.tsx 监听并打开样式化的 AboutDialog
              window.dispatchEvent(new CustomEvent('app:about'));
              break;
            case 'help_check_update':
              window.dispatchEvent(new CustomEvent('app:open-settings'));
              break;
          }
        });
      } catch {
        // Tauri API 不可用时静默忽略
      }
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, [desktop, authState]);
}
