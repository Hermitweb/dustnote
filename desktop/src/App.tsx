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

export function App() {
  useEffect(() => {
    if (isTauri()) {
      // 标记平台：web 端某些逻辑（如 update-manifest 灰度）可据此区分
      document.documentElement.dataset.platform = 'desktop';

      // 注册 autostart 全局 API（供 web SettingsDialog 在 Tauri 环境下调用）
      registerAutostartApi();

      // 注册 Velopack 更新 API（供 web SettingsDialog 在 Tauri 环境下调用）
      registerUpdaterApi();

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

  // 直接渲染 web 端 App（已包含 Sidebar / Editor / SetupScreen / UnlockScreen /
  // SettingsDialog / ForceUpdateOverlay / UpdateBanner 以及 useUpdateCheck）
  return <WebApp />;
}

export default App;
