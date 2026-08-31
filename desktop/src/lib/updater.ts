/**
 * 应用内更新前端桥接（v2.5.19 起替代 Velopack）
 *
 * 更新通道：
 * - 检查：自建服务器 /api/v1/update-manifest（RECOMMENDED_CLIENT_VERSION /
 *   latest.version，无 GitHub API 限流问题）
 * - 下载：GitHub Releases 直链（manifest 的 desktop.windows.url，指向 NSIS
 *   安装包；releases/download 域走 CDN 不限流），Rust 侧流式下载 + SHA-256
 *   校验（manifest 携带哈希）后启动安装向导
 *
 * 状态机：idle → checking → available → downloading → ready（向导已启动）
 *                  → uptodate                                  ↑
 *                  → error ──────────── (retry) ───────────────┘
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { isTauri } from './tauri';
import { useModeStore } from '../../../web/src/lib/mode-store';
import { getDeviceId } from '../../../web/src/lib/device';

/** 更新检查结果（对应 Rust 侧结构；保持与旧 Velopack 版接口形状一致） */
export interface UpdateCheckResult {
  updateAvailable: boolean;
  targetVersion: string | null;
  currentVersion: string;
  isDowngrade: boolean;
}

/** Rust 侧结构化错误 */
interface UpdaterError {
  kind: string;
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
  onDownloadProgress: (cb: (pct: number) => Promise<void> | void) => Promise<UnlistenFn>;
}

const UPDATER_GLOBAL = '__DUSTNOTE_UPDATER__';

/** manifest 返回的 Windows 安装包直链 + 哈希（checkForUpdates 成功后缓存） */
let cachedInstallerUrl: string | null = null;
let cachedInstallerSha256: string | null = null;

/** 简单语义版本比较：latest > current 返回 true（major.minor.patch 逐段数值） */
function isNewerVersion(latest: string, current: string): boolean {
  const l = latest.replace(/^v/, '').split('-')[0]!.split('.').map((p) => parseInt(p, 10) || 0);
  const c = current.replace(/^v/, '').split('-')[0]!.split('.').map((p) => parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const lv = l[i] ?? 0;
    const cv = c[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

/** 拉取自建 update-manifest（与 web 端 useUpdateCheck 同源，无限流问题） */
async function fetchManifest(): Promise<{
  latestVersion: string;
  installerUrl: string | null;
  installerSha256: string | null;
}> {
  const { serverUrl } = useModeStore.getState();
  if (!serverUrl) throw Object.assign(new Error('未配置服务器地址'), { kind: 'NoServer' });
  const apiBase = `${serverUrl.replace(/\/+$/, '')}/api/v1`;
  const deviceId = await getDeviceId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const r = await fetch(`${apiBase}/update-manifest`, {
      headers: {
        'X-Client-Version': __APP_VERSION__,
        'X-Client-Platform': 'desktop',
        'X-Client-Channel': 'stable',
        'X-Client-Device-Id': deviceId,
      },
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const m = (await r.json()) as {
      latest?: {
        version?: string;
        artifacts?: {
          desktop?: {
            windows?: { url?: string; hash?: string };
            windowsArm64?: { url?: string; hash?: string };
          };
        };
      };
    };
    const latestVersion = m.latest?.version ?? '';
    if (!latestVersion) throw new Error('manifest 缺少 latest.version');
    // 按本机 CPU 架构选安装包：Rust std::env::consts::ARCH（Windows ARM64 上
    // navigator UA 会伪装 x64，不能依赖浏览器判断）；旧服务器清单没有
    // windowsArm64 字段时回退 x64 包。
    const arch = await invoke<string>('app_arch');
    const desktopArt = m.latest?.artifacts?.desktop;
    const target =
      arch === 'aarch64' ? (desktopArt?.windowsArm64 ?? desktopArt?.windows) : desktopArt?.windows;
    return {
      latestVersion,
      installerUrl: target?.url ?? null,
      installerSha256: target?.hash ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 把 Velopack 更新 API 挂到 window 上，供复用的 web 组件访问 */
export function registerUpdaterApi(): void {
  if (!isTauri()) return;
  if (typeof window === 'undefined') return;
  const api: UpdaterApi = {
    checkForUpdates: async () => {
      const currentVersion = await invoke<string>('app_version');
      const m = await fetchManifest();
      const updateAvailable = isNewerVersion(m.latestVersion, currentVersion);
      if (updateAvailable && m.installerUrl) {
        cachedInstallerUrl = m.installerUrl;
        // hash 空串归一为 null：服务端 manifest 的 hash 是占位空串，
        // 若原样透传会被 Rust 侧当作期望值做 SHA-256 比对 → 恒失败
        cachedInstallerSha256 = m.installerSha256 || null;
      } else {
        cachedInstallerUrl = null;
        cachedInstallerSha256 = null;
      }
      return {
        updateAvailable,
        targetVersion: updateAvailable ? m.latestVersion : null,
        currentVersion,
        isDowngrade: false,
      };
    },
    downloadUpdates: async () => {
      if (!cachedInstallerUrl) return false;
      // 白名单由前端下发：GitHub Releases 前缀 + 用户配置的服务器 origin
      //（manifest 与安装包都来自该服务器，产物已切自托管下载）
      const { serverUrl } = useModeStore.getState();
      const origin = serverUrl?.replace(/\/+$/, '') ?? '';
      await invoke<string>('download_and_run_installer', {
        url: cachedInstallerUrl,
        expectedSha256: cachedInstallerSha256,
        allowedPrefixes: [
          'https://github.com/Hermitweb/dustnote/releases/download/',
          origin ? `${origin}/` : '',
        ].filter(Boolean),
      });
      return true;
    },
    // NSIS 安装向导接管升级；无"应用重启"步骤
    applyAndRestart: () => Promise.resolve(),
    getPendingUpdate: () => Promise.resolve(null),
    getCurrentVersion: () => invoke<string>('app_version'),
    onDownloadProgress: (cb) =>
      listen<number>('updater://download-progress', (e) => void cb(e.payload)),
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
 * React hook：管理检查/下载全流程状态机
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

  // 注意：API 在 App.tsx 的注册 effect 中才挂到 window（__DUSTNOTE_UPDATER__），
  // render 期取到的一律为 null，故不在 render 期缓存，统一在函数内延迟解析。

  async function check(): Promise<void> {
    const api = getUpdaterApi();
    if (!api) return;
    // 单机模式（无 serverUrl）：manifest 无从谈起，静默跳过（每次启动
    // 白跑一次并置 error 态无任何 UI 消费）
    if (!useModeStore.getState().serverUrl) return;
    setState('checking');
    setError(null);
    try {
      // 超时保护：网络挂起时避免界面卡死（15s，含 manifest 请求）
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('检查更新超时，请稍后重试')), 15_000)
      );
      const r = await Promise.race([api.checkForUpdates(), timeoutPromise]);
      setCurrentVersion(r.currentVersion);
      setTargetVersion(r.targetVersion);
      setState(r.updateAvailable ? 'available' : 'uptodate');
    } catch (e) {
      const err = e as UpdaterError;
      setError(err?.message ?? String(e));
      setState('error');
    }
  }

  async function download(): Promise<void> {
    const api = getUpdaterApi();
    if (!api) return;
    setState('downloading');
    setProgress(0);
    const unlisten = await api.onDownloadProgress((pct) => setProgress(pct));
    try {
      // NSIS 包约 100-200MB，按较慢网络放宽超时（10 分钟）
      const downloadTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('下载超时')), 600_000)
      );
      const ok = await Promise.race([api.downloadUpdates(), downloadTimeout]);
      // 'ready' = 安装向导已启动，用户在向导中完成升级
      setState(ok ? 'ready' : 'uptodate');
    } catch (e) {
      setError((e as UpdaterError)?.message ?? String(e));
      setState('error');
    } finally {
      unlisten();
    }
  }

  // 兼容旧状态机签名：NSIS 流程无"应用已下载的更新并重启"，no-op
  async function applyAndRestart(): Promise<void> {
    const api = getUpdaterApi();
    if (!api) return;
    await api.applyAndRestart();
  }

  // 桌面端启动时静默检查一次（失败静默：错误在设置页手动检查时可见）
  useEffect(() => {
    const api = getUpdaterApi();
    if (!api) return;
    void (async () => {
      try {
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
