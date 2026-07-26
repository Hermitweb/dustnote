/**
 * Velopack 自动更新前端桥接
 *
 * 设计同 autostart.ts：
 * - 仅 Tauri 桌面环境下注册
 * - 暴露 window.__DUSTNOTE_UPDATER__ 给复用的 web SettingsDialog 调用
 * - web 端不静态 import 任何 Tauri 包，走全局变量
 *
 * 更新流程状态机：
 *   idle → checking → available → downloading → ready → (apply & restart)
 *                    → uptodate                                  ↑
 *                    → error ──────────── (retry) ───────────────┘
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { isTauri } from './tauri';

/** 更新检查结果（对应 Rust 侧 UpdateCheckResult） */
export interface UpdateCheckResult {
  updateAvailable: boolean;
  targetVersion: string | null;
  currentVersion: string;
  isDowngrade: boolean;
}

/** Rust 侧返回的结构化错误 */
interface UpdaterError {
  kind: string; // "NotInstalled" | "Network" | "Unknown"
  message: string;
}

/** 更新流程状态 */
export type UpdaterState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'uptodate'
  | 'error';

/** 暴露给 web SettingsDialog 的精简 API */
export interface UpdaterApi {
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadUpdates: () => Promise<boolean>;
  applyAndRestart: () => Promise<void>;
  getPendingUpdate: () => Promise<string | null>;
  getCurrentVersion: () => Promise<string>;
  onDownloadProgress: (cb: (pct: number) => void) => Promise<UnlistenFn>;
}

const UPDATER_GLOBAL = '__DUSTNOTE_UPDATER__';

/** 把 Velopack 更新 API 挂到 window 上，供复用的 web 组件访问 */
export function registerUpdaterApi(): void {
  if (!isTauri()) return;
  if (typeof window === 'undefined') return;
  const api: UpdaterApi = {
    checkForUpdates: () => invoke<UpdateCheckResult>('vp_check_for_updates'),
    downloadUpdates: () => invoke<boolean>('vp_download_updates'),
    applyAndRestart: () => invoke<void>('vp_apply_and_restart'),
    getPendingUpdate: () => invoke<string | null>('vp_get_pending_update'),
    getCurrentVersion: () => invoke<string>('vp_current_version'),
    onDownloadProgress: (cb) => listen<number>('vp://download-progress', (e) => cb(e.payload)),
  };
  (window as unknown as Record<string, unknown>)[UPDATER_GLOBAL] = api;
}

/** 读取已注册的更新 API（仅在 Tauri 环境下返回） */
export function getUpdaterApi(): UpdaterApi | null {
  if (!isTauri()) return null;
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as Record<string, unknown>)[UPDATER_GLOBAL];
  return (api as UpdaterApi) ?? null;
}

/**
 * React hook：管理检查/下载/应用全流程状态机
 * 仅桌面端有效，web 端返回 idle 状态 no-op
 */
export function useUpdater(): {
  state: UpdaterState;
  targetVersion: string | null;
  currentVersion: string | null;
  progress: number; // 0-100
  error: string | null;
  check: () => Promise<void>;
  download: () => Promise<void>;
  applyAndRestart: () => Promise<void>;
} {
  const [state, setState] = useState<UpdaterState>('idle');
  const [targetVersion, setTargetVersion] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const api = getUpdaterApi();

  async function check(): Promise<void> {
    if (!api) return;
    setState('checking');
    setError(null);
    try {
      const r = await api.checkForUpdates();
      setCurrentVersion(r.currentVersion);
      setTargetVersion(r.targetVersion);
      setState(r.updateAvailable ? 'available' : 'uptodate');
    } catch (e) {
      const err = e as UpdaterError;
      // dev 期 NotInstalled 属预期，静默回 idle
      if (err?.kind === 'NotInstalled') {
        setState('idle');
        return;
      }
      setError(err?.message ?? String(e));
      setState('error');
    }
  }

  async function download(): Promise<void> {
    if (!api) return;
    setState('downloading');
    setProgress(0);
    const unlisten = await api.onDownloadProgress((pct) => setProgress(pct));
    try {
      const ok = await api.downloadUpdates();
      setState(ok ? 'ready' : 'uptodate');
    } catch (e) {
      setError((e as UpdaterError)?.message ?? String(e));
      setState('error');
    } finally {
      unlisten();
    }
  }

  async function applyAndRestart(): Promise<void> {
    if (!api) return;
    try {
      await api.applyAndRestart();
    } catch (e) {
      setError((e as UpdaterError)?.message ?? String(e));
      setState('error');
    }
  }

  // 桌面端启动时静默检查 + 检查是否有待应用更新
  useEffect(() => {
    if (!api) return;
    void (async () => {
      try {
        // 若有 pending 更新，直接进入 ready 状态等用户点击
        const pending = await api.getPendingUpdate();
        if (pending) {
          setTargetVersion(pending);
          setState('ready');
          return;
        }
        // 否则启动后静默检查一次
        await check();
      } catch {
        /* swallow: dev 环境正常 */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    state,
    targetVersion,
    currentVersion,
    progress,
    error,
    check,
    download,
    applyAndRestart,
  };
}
