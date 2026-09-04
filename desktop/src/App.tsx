/**
 * DustNote Desktop 主入口
 *
 * 桌面端与 Web 端复用 @dustnote/web 的组件层。
 * 本文件实现：
 * 1. Tauri 检测（仅在桌面环境下启用原生能力）
 * 2. 平台标识：注入 X-Client-Platform: desktop
 * 3. autostart 桥接（注册到 window，供复用的 web SettingsDialog 读取）
 * 4. update-check 复用 web 端的 useUpdateCheck（由 web App 内部触发）
 *
 * 注意：web App 默认导出是主界面，已自带：
 * - 解锁/初始化流程 (SetupScreen / UnlockScreen)
 * - 主界面 Sidebar + Editor
 * - 更新检测 (useUpdateCheck) + 强制升级遮罩 (ForceUpdateOverlay)
 * - 软提示横幅 (UpdateBanner)
 * 桌面端只需在此基础上注入桌面原生能力即可。
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from './lib/tauri';
import { registerAutostartApi } from './lib/autostart';
import { registerUpdaterApi, useUpdater } from './lib/updater';
import { notifyUpdateAvailable } from './lib/notifications';
// 直接复用 web 端 App 组件（vite + tsc 通过相对路径解析）
import WebApp from '../../web/src/App';
import { useStore } from '../../web/src/lib/store';

/**
 * 注册桌面端原生能力到 window，供共享的 web 组件（AboutDialog、ImportExportDialog 等）调用。
 *
 * 这些 API 仅在 Tauri 环境下注册，web 端运行时 window 上不存在对应字段，
 * 组件内通过 `isTauri() && window.__dustnoteXxx` 判断后调用。
 */
function registerDesktopApis() {
  // 1. 打开外部 URL（GitHub 链接等）：使用 opener 插件调用系统默认浏览器
  void import('@tauri-apps/plugin-opener').then(({ openUrl }) => {
    (window as unknown as { __dustnoteOpenUrl: (url: string) => Promise<void> }).__dustnoteOpenUrl =
      (url: string) => openUrl(url);
  });

  // 2. 原生保存对话框 + 写文件：供导出备份/批量导出使用
  void import('@tauri-apps/api/core').then(({ invoke }) => {
    (
      window as unknown as {
        __dustnoteSaveFile: (filename: string, content: Uint8Array) => Promise<string | null>;
      }
    ).__dustnoteSaveFile = async (filename: string, content: Uint8Array) => {
      // Uint8Array → Vec<u8>：Tauri invoke 要求 plain object，先转 Array
      const result = await invoke<string | null>('save_file_dialog', {
        filename,
        content: Array.from(content),
      });
      return result;
    };
  });
}

/** 注册托盘 tooltip 更新能力（roadmap M4「托盘显示已同步 N 条」） */
function registerTrayApi() {
  void import('@tauri-apps/api/core').then(({ invoke }) => {
    (
      window as unknown as { __dustnoteSetTrayTooltip: (tooltip: string) => void }
    ).__dustnoteSetTrayTooltip = (tooltip: string) => {
      void invoke('set_tray_tooltip', { tooltip }).catch(() => undefined);
    };
    (
      window as unknown as {
        __dustnoteSetTrayMenuLang: (lang: string) => void;
      }
    ).__dustnoteSetTrayMenuLang = (lang: string) => {
      void invoke('set_tray_menu_lang', { lang }).catch(() => undefined);
    };
    (
      window as unknown as {
        __dustnoteSetContentProtected: (protected_: boolean) => void;
      }
    ).__dustnoteSetContentProtected = (protected_: boolean) => {
      void invoke('set_content_protected', { protected: protected_ }).catch(() => undefined);
    };
  });
}

export function App() {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    if (isTauri()) {
      // 标记平台：web 端某些逻辑（如 update-manifest 灰度）可据此区分
      document.documentElement.dataset.platform = 'desktop';

      // 注册 autostart 全局 API（供 web SettingsDialog 在 Tauri 环境下调用）
      registerAutostartApi();

      // 注册 Velopack 更新 API（供 web SettingsDialog 在 Tauri 环境下调用）
      registerUpdaterApi();

      // 注册桌面端原生能力（openUrl、saveFile），供共享 web 组件调用
      registerDesktopApis();

      // 注册托盘 tooltip 更新能力
      registerTrayApi();

      // 托盘菜单跟随应用语言;截屏偏好(localStorage)恢复
      const syncTrayLang = () => {
        (
          window as unknown as { __dustnoteSetTrayMenuLang?: (lang: string) => void }
        ).__dustnoteSetTrayMenuLang?.(i18n.language);
      };
      syncTrayLang();
      i18n.on('languageChanged', syncTrayLang);
      try {
        const allowScreenshot = localStorage.getItem('dustnote_allow_screenshot') === '1';
        (
          window as unknown as { __dustnoteSetContentProtected?: (v: boolean) => void }
        ).__dustnoteSetContentProtected?.(!allowScreenshot);
      } catch {
        /* ignore */
      }

      // 设置窗口标题（跟随语言：中文「尘渊笔记」/ 英文「DustNote」，
      // tauri.conf.json 的静态 title 仅为启动初帧兜底）
      void import('@tauri-apps/api/window')
        .then(async ({ Window }) => {
          try {
            await Window.getCurrent().setTitle(t('app.name'));
          } catch {
            /* 忽略：极少数环境下窗口尚未创建 */
          }
        })
        .catch(() => undefined);
    } else {
      document.documentElement.dataset.platform = 'web';
    }
  }, []);

  // 语言切换时同步窗口标题（启动 effect 依赖 [] 不会重跑，这里单独跟随 i18n.language）
  useEffect(() => {
    if (!isTauri()) return;
    void import('@tauri-apps/api/window')
      .then(async ({ Window }) => {
        try {
          await Window.getCurrent().setTitle(t('app.name'));
        } catch {
          /* 忽略 */
        }
      })
      .catch(() => undefined);
  }, [t, i18n.language]);

  // 桌面端更新检查状态机（启动时静默检查一次；独立于设置页内手动检查）。
  // 必须在上方注册 effect 之后调用：React 按声明顺序执行 effect，
  // useUpdater 内部的启动静默检查需要 window.__DUSTNOTE_UPDATER__ 已注册。
  const updater = useUpdater();

  // 更新可用系统通知：订阅 useUpdater 状态，检查发现有新版本（available）时
  // 发送「DustNote 有新版本」通知（设置页内手动检查走 SettingsDialog 自有状态，不触发）。
  useEffect(() => {
    if (!isTauri()) return;
    if (updater.state === 'available' && updater.targetVersion) {
      void notifyUpdateAvailable(updater.targetVersion);
    }
  }, [updater.state, updater.targetVersion]);

  // 托盘 tooltip 显示待同步数量（roadmap M4「托盘显示已同步 N 条」）：
  // 订阅 web store 的 pendingCount 变化，实时刷新托盘 tooltip（文案跟随语言）。
  useEffect(() => {
    if (!isTauri()) return undefined;
    const setTip = () => {
      const api = (window as unknown as { __dustnoteSetTrayTooltip?: (t: string) => void })
        .__dustnoteSetTrayTooltip;
      if (!api) return;
      const count = useStore.getState().pendingCount;
      api(
        count > 0
          ? t('tray.pending_sync', { app: t('app.name'), count })
          : t('tray.synced', { app: t('app.name') })
      );
    };
    setTip();
    const unsub = useStore.subscribe(() => setTip());
    return () => unsub();
  }, [t, i18n.language]);

  // 直接渲染 web 端 App（已包含 Sidebar / Editor / SetupScreen / UnlockScreen /
  // SettingsDialog / ForceUpdateOverlay / UpdateBanner 以及 useUpdateCheck）
  return <WebApp />;
}

export default App;
