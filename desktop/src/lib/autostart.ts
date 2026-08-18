/**
 * 开机自启 (autostart) 前端桥接
 *
 * 设计：
 * - 静态 import @tauri-apps/plugin-autostart，让 Vite 把插件打进桌面端 bundle
 * - 通过 window.__DUSTNOTE_AUTOSTART__ 暴露 API，供复用的 web 端 SettingsDialog
 *   在 Tauri 环境下读取/切换（web 端不能静态 import 该包，故走全局变量）
 * - 仅在 Tauri 桌面环境下注册，浏览器环境为 no-op
 */

import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { useEffect, useState } from 'react';
import { isTauri } from './tauri';

/** 暴露给 web SettingsDialog 的精简 API */
export interface AutostartApi {
  isEnabled: () => Promise<boolean>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

const AUTOSTART_GLOBAL = '__DUSTNOTE_AUTOSTART__';

/** 把 autostart API 挂到 window 上，供复用的 web 组件访问 */
export function registerAutostartApi(): void {
  if (!isTauri()) return;
  if (typeof window === 'undefined') return;
  const api: AutostartApi = { isEnabled, enable, disable };
  (window as unknown as Record<string, unknown>)[AUTOSTART_GLOBAL] = api;
}

/** 读取已注册的 autostart API（仅在 Tauri 环境下返回） */
export function getAutostartApi(): AutostartApi | null {
  if (!isTauri()) return null;
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as Record<string, unknown>)[AUTOSTART_GLOBAL];
  return (api as AutostartApi) ?? null;
}

/** 启用 / 禁用 开机自启 */
export async function setAutostart(enabled: boolean): Promise<void> {
  const api = getAutostartApi();
  if (!api) return;
  if (enabled) await api.enable();
  else await api.disable();
}

/** 查询当前开机自启状态 */
export async function isAutostartEnabled(): Promise<boolean> {
  const api = getAutostartApi();
  if (!api) return false;
  try {
    return await api.isEnabled();
  } catch {
    return false;
  }
}

/**
 * React hook：返回 [当前是否启用, 切换函数, 是否已加载]
 * 仅供桌面端使用（web 端 isTauri 为 false 时返回 false / no-op）
 */
export function useAutostart(): {
  enabled: boolean;
  loading: boolean;
  toggle: (next: boolean) => Promise<void>;
} {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    void isAutostartEnabled()
      .then(setEnabled)
      .finally(() => setLoading(false));
  }, []);

  async function toggle(next: boolean): Promise<void> {
    if (!isTauri()) return;
    try {
      await setAutostart(next);
      setEnabled(await isAutostartEnabled());
    } catch (err) {
      console.error('[autostart] toggle failed', err);
      throw err;
    }
  }

  return { enabled, loading, toggle };
}
