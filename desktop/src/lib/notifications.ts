/**
 * 系统通知桥接（@tauri-apps/plugin-notification）
 *
 * 仅 Tauri 桌面环境下生效：
 * - 首次使用时申请系统通知权限（isPermissionGranted → requestPermission）
 * - 更新检查发现有新版本时发送系统通知
 * 权限被拒 / 插件不可用时静默降级，不影响主流程。
 */

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { isTauri } from './tauri';

/** 权限请求结果缓存：同一会话只申请一次（避免重复弹系统权限框） */
let permissionPromise: Promise<boolean> | null = null;

/** 确保通知权限已授予；返回是否允许发送通知 */
async function ensureNotificationPermission(): Promise<boolean> {
  if (!isTauri()) return false;
  if (permissionPromise) return permissionPromise;
  permissionPromise = (async () => {
    try {
      if (await isPermissionGranted()) return true;
      const granted = await requestPermission();
      return granted === 'granted';
    } catch {
      // dev 期插件未注册 / 系统不支持时静默降级
      return false;
    }
  })();
  return permissionPromise;
}

/** 已提醒过的版本号（去重：StrictMode 双挂载 / 多次检查只提醒一次） */
const notifiedVersions = new Set<string>();

/**
 * 发送「DustNote 有新版本」系统通知。
 * 权限未授予或同一版本已提醒过时静默跳过。
 */
export async function notifyUpdateAvailable(version: string): Promise<void> {
  if (!version || notifiedVersions.has(version)) return;
  if (!(await ensureNotificationPermission())) return;
  try {
    sendNotification({
      title: 'DustNote 有新版本',
      body: `新版本 ${version} 已可用，打开「设置 → 检查更新」即可下载。`,
    });
    notifiedVersions.add(version);
  } catch {
    /* 通知失败不影响主流程 */
  }
}
