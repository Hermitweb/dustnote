import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../lib/store';
import { THEMES } from '../lib/theme';
import { ImportExportDialog } from './ImportExportDialog';
import { SharesManager } from './SharesManager';
import { getConfig, saveConfig, loadConfig } from '../lib/config';

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

  // 桌面端：开机自启开关
  const desktopEnv = isTauri();
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);

  useEffect(() => {
    if (!desktopEnv) return;
    const api = getAutostartApi();
    if (!api) return;
    void api
      .isEnabled()
      .then(setAutostartEnabled)
      .catch(() => undefined);
  }, [desktopEnv]);

  async function toggleAutostart(next: boolean): Promise<void> {
    const api = getAutostartApi();
    if (!api || autostartBusy) return;
    setAutostartBusy(true);
    try {
      if (next) await api.enable();
      else await api.disable();
      setAutostartEnabled(await api.isEnabled());
    } catch (err) {
      console.error('[autostart] toggle failed', err);
    } finally {
      setAutostartBusy(false);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md rounded-2xl bg-surface-card p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-surface-fg">{t('settings.title')}</h2>
            <button onClick={onClose} className="text-surface-muted hover:text-surface-fg">
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
                数据管理
              </label>
              <div className="space-y-2">
                <button
                  onClick={() => setShowImportExport(true)}
                  className="w-full rounded-lg border border-surface-border px-3 py-2 text-left text-sm text-surface-fg hover:bg-surface-bg"
                >
                  <span className="mr-2">📥📤</span>导入 / 导出
                </button>
                <button
                  onClick={() => setShowShares(true)}
                  className="w-full rounded-lg border border-surface-border px-3 py-2 text-left text-sm text-surface-fg hover:bg-surface-bg"
                >
                  <span className="mr-2">🔗</span>分享管理
                </button>
              </div>
            </div>

            {/* 服务器地址 */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-surface-muted">
                🔗 服务器地址
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
                  {apiSaved ? '✅' : '保存'}
                </button>
              </div>
              <p className="mt-1 text-xs text-surface-muted">修改后需刷新页面生效</p>
            </div>

            {/* 桌面端：开机自启开关（仅 Tauri 环境显示） */}
            {desktopEnv && (
              <div>
                <label className="mb-2 block text-xs font-semibold text-surface-muted">
                  桌面端
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
                    <span>开机自启</span>
                  </span>
                  <span
                    className={`text-xs font-semibold ${autostartEnabled ? 'text-mint-700' : 'text-surface-muted'}`}
                  >
                    {autostartBusy ? '…' : autostartEnabled ? '已启用' : '已禁用'}
                  </span>
                </button>
              </div>
            )}

            {/* 关于 */}
            <div className="rounded-lg border border-surface-border p-3 text-xs text-surface-muted">
              <div>{t('settings.about')}: DustNote · 尘心笔记</div>
              <div className="font-mono">
                {t('settings.version')}: {__APP_VERSION__}
              </div>
              <div className="mt-1">E2EE · SQLite · 跨端同步</div>
            </div>
          </div>
        </div>
      </div>

      {showImportExport && <ImportExportDialog onClose={() => setShowImportExport(false)} />}
      {showShares && <SharesManager onClose={() => setShowShares(false)} />}
    </>
  );
}
