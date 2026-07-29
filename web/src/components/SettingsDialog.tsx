import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { THEMES } from '../lib/theme';
import { ImportExportDialog } from './ImportExportDialog';
import { SharesManager } from './SharesManager';
import { getConfig, saveConfig, loadConfig } from '../lib/config';
import i18n from '../lib/i18n';

/** 检测是否运行在 Tauri 桌面环境 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 桌面端 autostart API 形状（由 desktop/src/lib/autostart.ts 注册到 window 上） */
interface AutostartApi {
  isEnabled: () => Promise<boolean>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

function getAutostartApi(): AutostartApi | null {
  if (!isTauri()) return null;
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as Record<string, unknown>).__DUSTNOTE_AUTOSTART__;
  return (api as AutostartApi) ?? null;
}

/** 桌面端 Velopack 更新 API（由 desktop/src/lib/updater.ts 注册到 window 上） */
interface UpdateCheckResult {
  updateAvailable: boolean;
  targetVersion: string | null;
  currentVersion: string;
  isDowngrade: boolean;
}

interface UpdaterApi {
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadUpdates: () => Promise<boolean>;
  applyAndRestart: () => Promise<void>;
  getPendingUpdate: () => Promise<string | null>;
  getCurrentVersion: () => Promise<string>;
  onDownloadProgress: (cb: (pct: number) => void) => Promise<() => void>;
}

function getUpdaterApi(): UpdaterApi | null {
  if (!isTauri()) return null;
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as Record<string, unknown>).__DUSTNOTE_UPDATER__;
  return (api as UpdaterApi) ?? null;
}

/**
 * 为 Promise 添加超时保护，避免 Tauri IPC 调用挂起导致设置页卡死。
 * 超时后 reject，由调用方 catch 处理。
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(i18n.t('settings.op_timeout', { ms }))), ms)
    ),
  ]);
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const prefs = useStore((s) => s.preferences);
  const setTheme = useStore((s) => s.setTheme);
  const setMode = useStore((s) => s.setMode);
  const setLanguage = useStore((s) => s.setLanguage);

  const [showImportExport, setShowImportExport] = useState(false);
  const [showShares, setShowShares] = useState(false);

  // 服务器地址配置
  const [apiBase, setApiBase] = useState(getConfig().apiBase);
  const [apiSaved, setApiSaved] = useState(false);
  useEffect(() => {
    void loadConfig().then((c) => setApiBase(c.apiBase));
  }, []);

  // a11y：Esc 关闭对话框（与点击遮罩一致）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 桌面端：开机自启开关
  const desktopEnv = isTauri();
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);

  useEffect(() => {
    if (!desktopEnv) return;
    const api = getAutostartApi();
    if (!api) return;
    void withTimeout(api.isEnabled(), 5000)
      .then(setAutostartEnabled)
      .catch(() => undefined);
  }, [desktopEnv]);

  async function toggleAutostart(next: boolean): Promise<void> {
    const api = getAutostartApi();
    if (!api || autostartBusy) return;
    setAutostartBusy(true);
    try {
      if (next) await withTimeout(api.enable(), 5000);
      else await withTimeout(api.disable(), 5000);
      setAutostartEnabled(await withTimeout(api.isEnabled(), 5000));
    } catch (err) {
      console.error('[autostart] toggle failed', err);
    } finally {
      setAutostartBusy(false);
    }
  }

  // 桌面端：Velopack 应用更新
  const [updateState, setUpdateState] = useState<
    'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'uptodate' | 'error'
  >('idle');
  const [targetVer, setTargetVer] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateErr, setUpdateErr] = useState<string | null>(null);

  useEffect(() => {
    if (!desktopEnv) return;
    const api = getUpdaterApi();
    if (!api) return;
    // 打开设置时仅检查"是否有已下载待应用的更新"（本地磁盘读取，毫秒级）。
    // 不自动发起 checkForUpdates 网络请求——国内访问 GitHub Releases 慢/不稳，
    // 自动网络检查会让设置页打开时卡顿最多 10s。改为用户主动点"🔍 检查更新"。
    void (async () => {
      try {
        const pending = await withTimeout(api.getPendingUpdate(), 5000);
        if (pending) {
          setTargetVer(pending);
          setUpdateState('ready');
        }
        // 无 pending 则保持 idle，等用户主动点击"检查更新"
      } catch {
        // dev 期 NotInstalled 属预期
        setUpdateState('idle');
      }
    })();
  }, [desktopEnv]);

  async function handleCheckUpdate(): Promise<void> {
    const api = getUpdaterApi();
    if (!api) return;
    setUpdateState('checking');
    setUpdateErr(null);
    try {
      const r = await withTimeout(api.checkForUpdates(), 10000);
      setTargetVer(r.targetVersion);
      setUpdateState(r.updateAvailable ? 'available' : 'uptodate');
    } catch (e) {
      const err = e as { kind?: string; message?: string };
      if (err?.kind === 'NotInstalled') {
        setUpdateState('idle');
        return;
      }
      setUpdateErr(err?.message ?? String(e));
      setUpdateState('error');
    }
  }

  async function handleDownloadUpdate(): Promise<void> {
    const api = getUpdaterApi();
    if (!api) return;
    setUpdateState('downloading');
    setUpdateProgress(0);
    let unlisten: (() => void) | null = null;
    try {
      // 注册进度监听（带超时，避免 listen 调用挂起）
      unlisten = await withTimeout(api.onDownloadProgress((pct) => setUpdateProgress(pct)), 5000);
      // 下载本身可能较慢，给 10 分钟兜底超时；进度事件会持续刷新，正常下载不会触发
      const ok = await withTimeout(api.downloadUpdates(), 600000);
      setUpdateState(ok ? 'ready' : 'uptodate');
    } catch (e) {
      setUpdateErr((e as { message?: string })?.message ?? String(e));
      setUpdateState('error');
    } finally {
      unlisten?.();
    }
  }

  async function handleApplyAndRestart(): Promise<void> {
    const api = getUpdaterApi();
    if (!api) return;
    try {
      // 应用更新会触发重启，promise 通常不会 resolve（进程退出）；
      // 15s 超时仅作为重启失败的兜底
      await withTimeout(api.applyAndRestart(), 15000);
    } catch (e) {
      setUpdateErr((e as { message?: string })?.message ?? String(e));
      setUpdateState('error');
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
      >
        <div
          className="w-full max-w-md rounded-2xl bg-surface-card p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 id="settings-dialog-title" className="text-lg font-bold text-surface-fg">
              {t('settings.title')}
            </h2>
            <button
              onClick={onClose}
              className="text-surface-muted hover:text-surface-fg"
              aria-label={t('common.close')}
            >
              ✕
            </button>
          </div>

          <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
            {/* 主题 */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-surface-muted">
                {t('settings.theme')}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {THEMES.map((th) => (
                  <button
                    key={th.id}
                    onClick={() => setTheme(th.id)}
                    className={`flex flex-col items-center gap-1 rounded-lg border-2 p-3 transition-colors ${
                      prefs.theme === th.id
                        ? 'border-mint-500 bg-mint-50 dark:bg-mint-900/30'
                        : 'border-surface-border hover:bg-surface-bg'
                    }`}
                  >
                    <span className="text-2xl">{th.emoji}</span>
                    <span className="text-xs text-surface-fg">{th.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 模式 */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-surface-muted">
                {t('settings.mode')}
              </label>
              <div className="flex gap-2">
                {(['light', 'dark', 'auto'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm transition-colors ${
                      prefs.mode === m
                        ? 'border-mint-500 bg-mint-50 dark:bg-mint-900/30 text-surface-fg'
                        : 'border-surface-border text-surface-fg hover:bg-surface-bg'
                    }`}
                  >
                    {m === 'light'
                      ? `☀️ ${t('settings.mode_light')}`
                      : m === 'dark'
                        ? `🌙 ${t('settings.mode_dark')}`
                        : `🌓 ${t('settings.mode_auto')}`}
                  </button>
                ))}
              </div>
            </div>

            {/* 语言 */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-surface-muted">
                {t('settings.language')}
              </label>
              <div className="flex gap-2">
                {(['zh-CN', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLanguage(l)}
                    className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm transition-colors ${
                      prefs.language === l
                        ? 'border-mint-500 bg-mint-50 dark:bg-mint-900/30 text-surface-fg'
                        : 'border-surface-border text-surface-fg hover:bg-surface-bg'
                    }`}
                  >
                    {l === 'zh-CN' ? '中文' : 'English'}
                  </button>
                ))}
              </div>
            </div>

            {/* 数据管理 */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-surface-muted">
                {t('settings.data_mgmt')}
              </label>
              <div className="space-y-2">
                <button
                  onClick={() => setShowImportExport(true)}
                  className="w-full rounded-lg border border-surface-border px-3 py-2 text-left text-sm text-surface-fg hover:bg-surface-bg"
                >
                  <span className="mr-2">📥📤</span>{t('settings.import_export')}
                </button>
                <button
                  onClick={() => setShowShares(true)}
                  className="w-full rounded-lg border border-surface-border px-3 py-2 text-left text-sm text-surface-fg hover:bg-surface-bg"
                >
                  <span className="mr-2">🔗</span>{t('settings.shares_mgmt')}
                </button>
              </div>
            </div>

            {/* 服务器地址 */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-surface-muted">
                {t('settings.server_url_label')}
              </label>
              <div className="flex gap-2">
                <input
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  className="flex-1 rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm text-surface-fg focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-200"
                />
                <button
                  onClick={() => {
                    saveConfig({ apiBase });
                    setApiSaved(true);
                    setTimeout(() => setApiSaved(false), 1500);
                  }}
                  className="rounded-lg bg-mint-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-mint-700"
                >
                  {apiSaved ? '✅' : t('settings.save_btn')}
                </button>
              </div>
              <p className="mt-1 text-xs text-surface-muted">{t('settings.refresh_hint')}</p>
            </div>

            {/* 桌面端：开机自启开关（仅 Tauri 环境显示） */}
            {desktopEnv && (
              <div>
                <label className="mb-2 block text-xs font-semibold text-surface-muted">
                  {t('settings.desktop')}
                </label>
                <button
                  type="button"
                  disabled={autostartBusy}
                  onClick={() => void toggleAutostart(!autostartEnabled)}
                  className={`flex w-full items-center justify-between rounded-lg border-2 px-3 py-2 text-sm transition-colors ${
                    autostartEnabled
                      ? 'border-mint-500 bg-mint-50 text-surface-fg dark:bg-mint-900/30'
                      : 'border-surface-border text-surface-fg hover:bg-surface-bg'
                  } ${autostartBusy ? 'opacity-60' : ''}`}
                >
                  <span className="flex items-center gap-2">
                    <span>🚀</span>
                    <span>{t('settings.autostart')}</span>
                  </span>
                  <span
                    className={`text-xs font-semibold ${autostartEnabled ? 'text-mint-700' : 'text-surface-muted'}`}
                  >
                    {autostartBusy ? '…' : autostartEnabled ? t('settings.autostart_on') : t('settings.autostart_off')}
                  </span>
                </button>
              </div>
            )}

            {/* 桌面端：应用更新（仅 Tauri 环境显示） */}
            {desktopEnv && (
              <div>
                <label className="mb-2 block text-xs font-semibold text-surface-muted">
                  {t('settings.app_update')}
                </label>
                <div className="space-y-2 rounded-lg border-2 border-surface-border p-3">
                  {/* 当前版本 */}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-surface-fg">{t('settings.current_version')}</span>
                    <span className="font-mono text-surface-muted">{__APP_VERSION__}</span>
                  </div>

                  {/* 检查中 */}
                  {updateState === 'checking' && (
                    <div className="flex items-center gap-2 text-sm text-surface-muted">
                      <span className="animate-spin">⏳</span>
                      <span>{t('settings.checking_update')}</span>
                    </div>
                  )}

                  {/* 发现新版本 */}
                  {updateState === 'available' && targetVer && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-mint-700">{t('settings.new_version', { version: targetVer })}</span>
                      <button
                        onClick={() => void handleDownloadUpdate()}
                        className="rounded bg-mint-600 px-3 py-1 text-xs font-medium text-white hover:bg-mint-700"
                      >
                        {t('settings.download')}
                      </button>
                    </div>
                  )}

                  {/* 下载进度 */}
                  {updateState === 'downloading' && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-surface-muted">
                        <span>{t('settings.downloading', { progress: updateProgress })}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-surface-bg">
                        <div
                          className="h-full rounded-full bg-mint-500 transition-all"
                          style={{ width: `${updateProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* 更新就绪 */}
                  {updateState === 'ready' && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-mint-700">
                        {t('settings.update_ready')}{targetVer ? ` (v${targetVer})` : ''}
                      </span>
                      <button
                        onClick={() => void handleApplyAndRestart()}
                        className="rounded bg-mint-600 px-3 py-1 text-xs font-medium text-white hover:bg-mint-700"
                      >
                        {t('settings.restart_now')}
                      </button>
                    </div>
                  )}

                  {/* 已是最新 */}
                  {updateState === 'uptodate' && (
                    <div className="text-sm text-surface-muted">{t('settings.uptodate')}</div>
                  )}

                  {/* 错误 */}
                  {updateState === 'error' && (
                    <div className="space-y-1">
                      <div className="text-xs text-red-600">{updateErr}</div>
                      <button
                        onClick={() => void handleCheckUpdate()}
                        className="text-xs text-mint-700 underline hover:text-mint-800"
                      >
                        {t('settings.retry')}
                      </button>
                    </div>
                  )}

                  {/* 手动检查按钮（idle / uptodate / error 时显示） */}
                  {(updateState === 'idle' ||
                    updateState === 'uptodate' ||
                    updateState === 'error') && (
                    <button
                      onClick={() => void handleCheckUpdate()}
                      className="w-full rounded-lg border border-surface-border px-3 py-1.5 text-xs text-surface-fg hover:bg-surface-bg"
                    >
                      {t('settings.check_update')}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 关于 */}
            <div className="rounded-lg border border-surface-border p-3 text-xs text-surface-muted">
              <div>{t('settings.about')}: {t('settings.about_line')}</div>
              <div className="font-mono">
                {t('settings.version')}: {__APP_VERSION__}
              </div>
              <div className="mt-1">{t('settings.tech_stack')}</div>
            </div>
          </div>
        </div>
      </div>

      {showImportExport && <ImportExportDialog onClose={() => setShowImportExport(false)} />}
      {showShares && <SharesManager onClose={() => setShowShares(false)} />}
    </>
  );
}
