import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { THEMES } from '../lib/theme';
import { ImportExportDialog } from './ImportExportDialog';
import { SharesManager } from './SharesManager';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { MigrationWizard } from './MigrationWizard';
import { getConfig, saveConfig, loadConfig } from '../lib/config';
import i18n from '../lib/i18n';
import { usePwaInstall } from '../lib/use-pwa-install';
import { toast } from '../lib/toast';
import { ConfirmDialog } from './ConfirmDialog';
import { getDeviceId } from '../lib/device';
import { useModeStore } from '../lib/mode-store';
import type { AppMode } from '@dustnote/shared';

/** 构造绝对 API 基址（Tauri 桌面端必须用绝对地址，详见 SharesManager 注释） */
function settingsApiBase(): string {
  const { serverUrl } = useModeStore.getState();
  return serverUrl ? `${serverUrl.replace(/\/+$/, '')}/api/v1` : '/api/v1';
}

/** 设备列表项（对应服务端 GET /devices 返回结构） */
interface DeviceItem {
  id: string;
  name: string;
  platform: string;
  fingerprintSuffix: string;
  isCurrent: boolean;
  hasRefreshToken: boolean;
  lastActiveAt: string;
  createdAt: string;
}

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
  const setPreferences = useStore((s) => s.setPreferences);
  const changePassword = useStore((s) => s.changePassword);
  const switchMode = useStore((s) => s.switchMode);

  const [showImportExport, setShowImportExport] = useState(false);
  // 设备管理（联机模式）
  const appMode = useStore((s) => s.mode);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [kickTargetId, setKickTargetId] = useState<string | null>(null);
  // 删除账户（联机模式，GDPR Article 17）：两步确认
  const [deleteConfirmStep, setDeleteConfirmStep] = useState<1 | 2 | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // 修改主密码
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 单机/联机模式切换
  const [switchServerUrl, setSwitchServerUrl] = useState('');
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchConfirm, setSwitchConfirm] = useState<AppMode | null>(null);
  const [showShares, setShowShares] = useState(false);
  const pwaInstall = usePwaInstall();

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

  // ========== 设备管理 ==========
  const loadDevices = useCallback(async () => {
    if (appMode !== 'online') return;
    setDevicesLoading(true);
    setDevicesError(null);
    try {
      const token = useStore.getState().accessToken;
      const r = await fetch(`${settingsApiBase()}/devices`, {
        headers: {
          'X-Client-Version': __APP_VERSION__,
          'X-Client-Platform': 'web',
          'X-Client-Channel': 'stable',
          'X-Client-Device-Id': getDeviceId(),
          Authorization: `Bearer ${token}`,
        },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { devices: DeviceItem[] };
      setDevices(data.devices);
    } catch (err) {
      setDevicesError((err as Error).message);
    } finally {
      setDevicesLoading(false);
    }
  }, [appMode]);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  const kickDevice = async (id: string) => {
    try {
      const token = useStore.getState().accessToken;
      const r = await fetch(`${settingsApiBase()}/devices/${id}`, {
        method: 'DELETE',
        headers: {
          'X-Client-Version': __APP_VERSION__,
          'X-Client-Platform': 'web',
          'X-Client-Channel': 'stable',
          'X-Client-Device-Id': getDeviceId(),
          Authorization: `Bearer ${token}`,
        },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setDevices((prev) => prev.filter((d) => d.id !== id));
      toast.success(t('settings.device_kicked'));
    } catch (err) {
      toast.error(t('settings.device_kick_fail', { reason: (err as Error).message }));
    }
  };

  // ========== 删除账户（GDPR Article 17） ==========
  const deleteAccount = async () => {
    setDeleteBusy(true);
    try {
      const token = useStore.getState().accessToken;
      const r = await fetch(`${settingsApiBase()}/account`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Version': __APP_VERSION__,
          'X-Client-Platform': 'web',
          'X-Client-Channel': 'stable',
          'X-Client-Device-Id': getDeviceId(),
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ confirm: true }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onClose();
      toast.success(t('settings.delete_account_success'));
      // 锁定清密钥 → checkStatus 探测到服务端账户已不存在 → 回到 Setup 页
      useStore.getState().lock();
      void useStore.getState().checkStatus();
    } catch (err) {
      toast.error(t('settings.delete_account_fail', { reason: (err as Error).message }));
    } finally {
      setDeleteBusy(false);
      setDeleteConfirmStep(null);
    }
  };

  // ========== 修改主密码 ==========
  const handleChangePassword = async () => {
    setPwMsg(null);
    if (newPw.length < 8) {
      setPwMsg({ ok: false, text: t('auth.too_weak') });
      return;
    }
    if (newPw !== confirmPw) {
      setPwMsg({ ok: false, text: t('settings.password_mismatch') });
      return;
    }
    setPwBusy(true);
    try {
      await changePassword(curPw, newPw);
      setPwMsg({ ok: true, text: t('settings.password_changed') });
      setCurPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (err) {
      setPwMsg({
        ok: false,
        text: t('settings.password_change_fail', { reason: (err as Error).message }),
      });
    } finally {
      setPwBusy(false);
    }
  };

  // ========== 单机/联机模式切换（switchMode 内部已带失败回滚） ==========
  const handleSwitchMode = async (target: AppMode) => {
    setSwitchConfirm(null);
    // 切联机必须有服务器地址：输入为空且 store 也没有历史地址时直接报错，
    // 否则切过去后所有请求因 serverUrl 缺失而不可用（Windows 真机反馈"无法切换联机"）
    if (target === 'online' && !switchServerUrl.trim() && !useModeStore.getState().serverUrl) {
      setSwitchError(t('settings.switch_need_url'));
      return;
    }
    setSwitchBusy(true);
    setSwitchError(null);
    try {
      await switchMode(target, target === 'online' ? switchServerUrl.trim() || null : null);
      // checkStatus 失败不抛错（内部置 authState='error' 并渲染全屏错误页），
      // 此处读最终状态避免"先报成功、再跳错误页"的自相矛盾体验
      if (useStore.getState().authState === 'error') {
        toast.error(
          t('settings.mode_switch_fail', {
            reason: useStore.getState().serverError ?? '网络错误',
          })
        );
      } else {
        toast.success(t('settings.mode_switch_success'));
      }
    } catch (err) {
      setSwitchError((err as Error).message);
    } finally {
      setSwitchBusy(false);
    }
  };

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
      if (err?.kind === 'RateLimited') {
        // GitHub 更新源限流：提示性信息而非错误态（Rust 侧已用缓存回退，
        // 走到这里说明连缓存都没有，属首次安装后的短时间内）
        setUpdateErr(err?.message ?? String(e));
        setUpdateState('uptodate');
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
      unlisten = await withTimeout(
        api.onDownloadProgress((pct) => setUpdateProgress(pct)),
        5000
      );
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

            {/* 字体 */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-surface-muted">
                {t('settings.font')}
              </label>
              <div className="flex gap-2">
                {(['system', 'manrope', 'lxgw'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setPreferences({ font: f })}
                    className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm transition-colors ${
                      prefs.font === f
                        ? 'border-mint-500 bg-mint-50 dark:bg-mint-900/30 text-surface-fg'
                        : 'border-surface-border text-surface-fg hover:bg-surface-bg'
                    }`}
                  >
                    {f === 'system'
                      ? t('settings.font_system')
                      : f === 'manrope'
                        ? 'Manrope'
                        : t('settings.font_lxgw')}
                  </button>
                ))}
              </div>
            </div>

            {/* 行高密度 */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-surface-muted">
                {t('settings.density')}
              </label>
              <div className="flex gap-2">
                {(['comfortable', 'standard', 'compact'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setPreferences({ density: d })}
                    className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm transition-colors ${
                      prefs.density === d
                        ? 'border-mint-500 bg-mint-50 dark:bg-mint-900/30 text-surface-fg'
                        : 'border-surface-border text-surface-fg hover:bg-surface-bg'
                    }`}
                  >
                    {d === 'comfortable'
                      ? t('settings.density_comfortable')
                      : d === 'standard'
                        ? t('settings.density_standard')
                        : t('settings.density_compact')}
                  </button>
                ))}
              </div>
            </div>

            {/* 修改主密码 */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-surface-muted">
                {t('settings.change_password')}
              </label>
              <div className="space-y-2">
                <input
                  type="password"
                  value={curPw}
                  onChange={(e) => setCurPw(e.target.value)}
                  placeholder={t('settings.cur_password')}
                  className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm"
                />
                <input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder={t('settings.new_password')}
                  className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm"
                />
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder={t('settings.confirm_password')}
                  className="w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm"
                />
                {pwMsg && (
                  <p
                    className={`text-xs ${pwMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
                  >
                    {pwMsg.text}
                  </p>
                )}
                <button
                  onClick={() => void handleChangePassword()}
                  disabled={pwBusy}
                  className="w-full rounded-lg bg-mint-600 px-3 py-2 text-sm font-medium text-white hover:bg-mint-700 disabled:opacity-50"
                >
                  {pwBusy ? t('common.loading') : t('settings.change_password_btn')}
                </button>
              </div>
            </div>

            {/* 设备管理（仅联机模式） */}
            {appMode === 'online' && (
              <div>
                <label className="mb-2 block text-xs font-semibold text-surface-muted">
                  {t('settings.devices')}
                </label>
                <div className="space-y-2 rounded-lg border-2 border-surface-border p-3">
                  {devicesLoading && (
                    <p className="text-xs text-surface-muted">{t('shares.loading')}</p>
                  )}
                  {devicesError && (
                    <p className="text-xs text-red-600">
                      {t('settings.devices_load_fail', { reason: devicesError })}
                    </p>
                  )}
                  {!devicesLoading && !devicesError && devices.length === 0 && (
                    <p className="text-xs text-surface-muted">{t('settings.devices_empty')}</p>
                  )}
                  {devices.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-surface-border bg-surface-bg p-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm text-surface-fg">
                          <span className="truncate">{d.name}</span>
                          {d.isCurrent && (
                            <span className="rounded-full bg-mint-100 px-1.5 py-0.5 text-[10px] text-mint-700 dark:bg-mint-900/30 dark:text-mint-300">
                              {t('settings.device_current')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-surface-muted">
                          {d.platform} ·{' '}
                          {t('settings.device_last_active', {
                            time: new Date(d.lastActiveAt).toLocaleString('zh-CN'),
                          })}
                        </div>
                      </div>
                      {!d.isCurrent && (
                        <button
                          onClick={() => setKickTargetId(d.id)}
                          className="flex-shrink-0 rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100 dark:bg-red-900/30"
                        >
                          {t('settings.device_kick')}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 危险区：删除账户（仅联机模式，GDPR Article 17） */}
            {appMode === 'online' && (
              <div className="rounded-lg border-2 border-red-200 p-3 dark:border-red-900/50">
                <label className="mb-1 block text-xs font-semibold text-red-600 dark:text-red-400">
                  {t('settings.delete_account')}
                </label>
                <p className="mb-2 text-xs text-surface-muted">
                  {t('settings.delete_account_desc')}
                </p>
                <button
                  onClick={() => setDeleteConfirmStep(1)}
                  disabled={deleteBusy}
                  className="w-full rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {t('settings.delete_account')}
                </button>
              </div>
            )}

            {/* 单机/联机模式切换 */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-surface-muted">
                {t('settings.switch_mode_title')}
              </label>
              <p className="mb-2 text-xs text-surface-muted">
                {t('settings.current_mode')}:{' '}
                {appMode === 'standalone'
                  ? t('settings.app_mode_standalone')
                  : t('settings.app_mode_online')}
              </p>
              {/* 服务器地址：切联机的目标地址。始终显示——单机用户切联机时
                  也必须能填，否则切过去 serverUrl 为空导致联机不可用 */}
              <input
                value={switchServerUrl}
                onChange={(e) => setSwitchServerUrl(e.target.value)}
                placeholder={
                  appMode === 'standalone'
                    ? t('settings.server_url_switch_hint')
                    : t('settings.server_url_placeholder')
                }
                className="mb-2 w-full rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-sm"
              />
              <button
                onClick={() => setSwitchConfirm(appMode === 'standalone' ? 'online' : 'standalone')}
                disabled={switchBusy}
                className="w-full rounded-lg bg-mint-600 px-3 py-2 text-sm font-medium text-white hover:bg-mint-700 disabled:opacity-50"
              >
                {appMode === 'standalone'
                  ? t('settings.switch_to_online')
                  : t('settings.switch_to_standalone')}
              </button>
              <p className="mt-1 text-xs text-surface-muted">{t('settings.switch_mode_hint')}</p>
              {switchError && (
                <p className="mt-1 text-xs text-red-600">
                  {t('settings.mode_switch_fail', { reason: switchError })}
                </p>
              )}
            </div>

            {/* 自动锁屏（空闲 N 分钟自动锁定，§1.5 默认 15） */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-surface-muted">
                {t('settings.auto_lock')}
              </label>
              <div className="flex gap-2">
                {[0, 5, 15, 30, 60].map((n) => (
                  <button
                    key={n}
                    onClick={() => setPreferences({ autoLock: n })}
                    className={`flex-1 rounded-lg border-2 px-2 py-2 text-sm transition-colors ${
                      prefs.autoLock === n
                        ? 'border-mint-500 bg-mint-50 dark:bg-mint-900/30 text-surface-fg'
                        : 'border-surface-border text-surface-fg hover:bg-surface-bg'
                    }`}
                  >
                    {n === 0 ? t('settings.auto_lock_off') : t('settings.auto_lock_min', { n })}
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
                  <span className="mr-2">📥📤</span>
                  {t('settings.import_export')}
                </button>
                <button
                  onClick={() => setShowShares(true)}
                  className="w-full rounded-lg border border-surface-border px-3 py-2 text-left text-sm text-surface-fg hover:bg-surface-bg"
                >
                  <span className="mr-2">🔗</span>
                  {t('settings.shares_mgmt')}
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
                    {autostartBusy
                      ? '…'
                      : autostartEnabled
                        ? t('settings.autostart_on')
                        : t('settings.autostart_off')}
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
                      <span className="text-mint-700">
                        {t('settings.new_version', { version: targetVer })}
                      </span>
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

                  {/* 安装向导已启动（NSIS 流程：下载完成→SHA-256 校验→向导自动弹出） */}
                  {updateState === 'ready' && (
                    <div className="text-sm text-mint-700">
                      {t('settings.update_ready')}
                      {targetVer ? ` (v${targetVer})` : ''}
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
            <DiagnosticsPanel />
            <div className="rounded-lg border border-surface-border p-3">
              <MigrationWizard onClose={() => {}} />
            </div>
            <div className="rounded-lg border border-surface-border p-3 text-xs text-surface-muted">
              <div>
                {t('settings.about')}: {t('settings.about_line')}
              </div>
              <div className="font-mono">
                {t('settings.version')}: {__APP_VERSION__}
              </div>
              <div className="mt-1">{t('settings.tech_stack')}</div>
              {pwaInstall.canInstall && (
                <button
                  className="mt-2 rounded-md bg-mint-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-mint-600"
                  onClick={() => void pwaInstall.install()}
                >
                  📲 安装为桌面应用
                </button>
              )}
              {pwaInstall.installed && (
                <div className="mt-2 text-mint-600 dark:text-mint-400">✓ 已安装为独立应用</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {kickTargetId && (
        <ConfirmDialog
          title={t('settings.device_kick')}
          message={t('settings.device_kick_confirm', {
            name: devices.find((d) => d.id === kickTargetId)?.name ?? '',
          })}
          confirmLabel={t('settings.device_kick')}
          variant="danger"
          onConfirm={() => {
            const id = kickTargetId;
            setKickTargetId(null);
            void kickDevice(id);
          }}
          onCancel={() => setKickTargetId(null)}
        />
      )}

      {deleteConfirmStep === 1 && (
        <ConfirmDialog
          title={t('settings.delete_account')}
          message={t('settings.delete_account_confirm_1')}
          confirmLabel={t('common.continue')}
          variant="danger"
          onConfirm={() => setDeleteConfirmStep(2)}
          onCancel={() => setDeleteConfirmStep(null)}
        />
      )}

      {deleteConfirmStep === 2 && (
        <ConfirmDialog
          title={t('settings.delete_account')}
          message={t('settings.delete_account_confirm_2')}
          confirmLabel={deleteBusy ? t('common.loading') : t('settings.delete_account')}
          variant="danger"
          onConfirm={() => void deleteAccount()}
          onCancel={() => setDeleteConfirmStep(null)}
        />
      )}

      {switchConfirm && (
        <ConfirmDialog
          title={t('settings.switch_mode_title')}
          message={
            switchConfirm === 'online'
              ? t('settings.confirm_switch_to_online')
              : t('settings.confirm_switch_to_standalone')
          }
          confirmLabel={t('settings.migrate_data')}
          onConfirm={() => void handleSwitchMode(switchConfirm)}
          onCancel={() => setSwitchConfirm(null)}
        />
      )}

      {showImportExport && <ImportExportDialog onClose={() => setShowImportExport(false)} />}
      {showShares && <SharesManager onClose={() => setShowShares(false)} />}
    </>
  );
}
