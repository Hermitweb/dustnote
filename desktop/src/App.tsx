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
import { isTauri } from './lib/tauri';
import { registerAutostartApi } from './lib/autostart';
import { registerUpdaterApi } from './lib/updater';
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
    (window as unknown as { __dustnoteOpenUrl: (url: string) => Promise<void> }).__dustnoteOpenUrl = (
      url: string
    ) => openUrl(url);
  });

  // 2. 原生保存对话框 + 写文件：供导出备份/批量导出使用
  void import('@tauri-apps/api/core').then(({ invoke }) => {
    (window as unknown as {
      __dustnoteSaveFile: (filename: string, content: Uint8Array) => Promise<string | null>;
    }).__dustnoteSaveFile = async (filename: string, content: Uint8Array) => {
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
    (window as unknown as { __dustnoteSetTrayTooltip: (tooltip: string) => void }).__dustnoteSetTrayTooltip = (
      tooltip: string
    ) => {
      void invoke('set_tray_tooltip', { tooltip }).catch(() => undefined);
    };
  });
}

export function App() {
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

      // 设置窗口标题（与 web 端 index.html 的 title 对齐）
      void import('@tauri-apps/api/window')
        .then(async ({ Window }) => {
          try {
            await Window.getCurrent().setTitle('DustNote · 尘心笔记');
          } catch {
            /* 忽略：极少数环境下窗口尚未创建 */
          }
        })
        .catch(() => undefined);
    } else {
      document.documentElement.dataset.platform = 'web';
    }
  }, []);

  // 托盘 tooltip 显示待同步数量（roadmap M4「托盘显示已同步 N 条」）：
  // 订阅 web store 的 pendingCount 变化，实时刷新托盘 tooltip。
  useEffect(() => {
    if (!isTauri()) return undefined;
    const setTip = () => {
      const api = (window as unknown as { __dustnoteSetTrayTooltip?: (t: string) => void })
        .__dustnoteSetTrayTooltip;
      if (!api) return;
      const count = useStore.getState().pendingCount;
      api(count > 0 ? `尘心笔记 · 待同步 ${count} 条` : '尘心笔记 · 已同步');
    };
    setTip();
    const unsub = useStore.subscribe(() => setTip());
    return () => unsub();
  }, []);

  // 直接渲染 web 端 App（已包含 Sidebar / Editor / SetupScreen / UnlockScreen /
  // SettingsDialog / ForceUpdateOverlay / UpdateBanner 以及 useUpdateCheck）
  return <WebApp />;
}

export default App;
