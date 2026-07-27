import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from './lib/store';
import { useModeStore } from './lib/mode-store';
import { applyTheme, watchSystemTheme } from './lib/theme';
import { useUpdateCheck } from './lib/use-update-check';
import { ForceUpdateOverlay } from './components/ForceUpdateOverlay';
import { UpdateBanner } from './components/UpdateBanner';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { SettingsDialog } from './components/SettingsDialog';
import { SharesManager } from './components/SharesManager';
import { AdminConfig } from './components/AdminConfig';
import { ModeSelectDialog } from './components/ModeSelectDialog';
import { SetupScreen } from './screens/SetupScreen';
import { UnlockScreen } from './screens/UnlockScreen';
import { StandaloneSetupScreen } from './screens/StandaloneSetupScreen';
import { StandaloneUnlockScreen } from './screens/StandaloneUnlockScreen';
import { StandaloneRecoverScreen } from './screens/StandaloneRecoverScreen';
import { PublicShareView } from './screens/PublicShareView';
import { startSyncWs, stopSyncWs } from './lib/sync-ws';
import { loadConfig } from './lib/config';
import { installOnlineListener } from './lib/online-listener';
import './lib/i18n';

type StandaloneView = 'setup' | 'unlock' | 'recover';

function App() {
  const { t } = useTranslation();
  const authState = useStore((s) => s.authState);
  const serverError = useStore((s) => s.serverError);
  const mode = useStore((s) => s.mode);
  const checkStatus = useStore((s) => s.checkStatus);
  const loadAll = useStore((s) => s.loadAll);
  const preferences = useStore((s) => s.preferences);
  const lock = useStore((s) => s.lock);
  const initRepository = useStore((s) => s.initRepository);
  const refreshPendingCount = useStore((s) => s.refreshPendingCount);
  const updateCheck = useUpdateCheck();

  const modeInitialized = useModeStore((s) => s.initialized);

  const [showSettings, setShowSettings] = useState(false);
  const [showShares, setShowShares] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [standaloneView, setStandaloneView] = useState<StandaloneView>('setup');

  // 启动：检查模式 + 初始化 Repository + 检查状态 + 加载配置
  useEffect(() => {
    if (!modeInitialized) return;
    initRepository();
    void checkStatus();
    void loadConfig();
    installOnlineListener();
  }, [checkStatus, loadAll, modeInitialized, initRepository]);

  // 应用主题
  useEffect(() => {
    applyTheme(preferences.theme, preferences.mode);
    const cleanup = watchSystemTheme(preferences.theme, preferences.mode);
    return cleanup;
  }, [preferences.theme, preferences.mode]);

  // 解锁后加载数据 + 启动 WS + 刷新待同步计数
  useEffect(() => {
    if (authState === 'unlocked') {
      void loadAll();
      void refreshPendingCount();
      // 仅联机模式启动 WS 同步
      if (mode === 'online') {
        startSyncWs();
        return () => stopSyncWs();
      }
    }
    return undefined;
  }, [authState, loadAll, refreshPendingCount, mode]);

  // 公开分享路由：/share/:token
  const shareMatch = location.pathname.match(/^\/share\/([A-Za-z0-9_-]+)$/);
  if (shareMatch) {
    return <PublicShareView token={shareMatch[1]!} />;
  }

  // 强制升级
  if (
    updateCheck.result &&
    (updateCheck.result.forceLevel === 'L0_block' ||
      updateCheck.result.forceLevel === 'L1_2nd_startup')
  ) {
    return <ForceUpdateOverlay result={updateCheck.result} />;
  }

  // 首次启动：模式选择
  if (!modeInitialized) {
    return <ModeSelectDialog />;
  }

  // 认证流程
  if (authState === 'unknown') {
    return (
      <div className="flex h-full items-center justify-center bg-surface-bg text-surface-muted">
        <div className="text-center">
          <div className="mb-2 text-3xl">🌿</div>
          <div className="text-sm">加载中...</div>
        </div>
      </div>
    );
  }

  // 联机模式：服务器不可达，显示错误重试界面（避免卡在加载中）
  if (authState === 'error') {
    return (
      <div className="flex h-full items-center justify-center bg-surface-bg p-6">
        <div className="w-full max-w-md rounded-2xl border border-surface-border bg-surface-card p-8 text-center shadow-xl">
          <div className="mb-4 text-4xl">⚠️</div>
          <h2 className="mb-2 text-lg font-semibold text-surface-fg">无法连接到服务器</h2>
          <p className="mb-1 text-sm text-surface-muted">
            请确认服务器已启动且地址正确。
          </p>
          {serverError && (
            <p className="mb-6 break-all rounded-lg bg-surface-bg px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {serverError}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => {
                useModeStore.getState().resetMode();
                location.reload();
              }}
              className="flex-1 rounded-lg border border-surface-border px-4 py-2.5 text-sm font-medium text-surface-fg hover:bg-surface-bg"
            >
              重新选择模式
            </button>
            <button
              onClick={() => {
                useStore.setState({ authState: 'unknown', serverError: null });
                void checkStatus();
              }}
              className="flex-1 rounded-lg bg-mint-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-mint-700"
            >
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 单机模式鉴权流程
  if (mode === 'standalone') {
    if (authState === 'uninitialized') {
      return <StandaloneSetupScreen />;
    }
    if (authState === 'needs_unlock') {
      if (standaloneView === 'recover') {
        return (
          <StandaloneRecoverScreen onBack={() => setStandaloneView('unlock')} />
        );
      }
      return (
        <StandaloneUnlockScreen onRecover={() => setStandaloneView('recover')} />
      );
    }
  } else {
    // 联机模式鉴权流程
    if (authState === 'uninitialized') return <SetupScreen />;
    if (authState === 'needs_unlock') return <UnlockScreen />;
  }

  // 主界面
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        {/* 顶部操作条 */}
        <header className="flex items-center gap-2 border-b border-surface-border bg-surface-card px-4 py-2">
          <div className="text-sm text-surface-muted">{t('app.tagline')}</div>
          <div className="ml-auto flex items-center gap-2">
            {mode === 'standalone' && (
              <span className="rounded bg-mint-100 px-2 py-0.5 text-xs text-mint-700 dark:bg-mint-900/30 dark:text-mint-300">
                {t('settings.app_mode_standalone')}
              </span>
            )}
            {mode === 'online' && (
              <>
                <button
                  onClick={() => setShowAdmin(true)}
                  className="rounded p-1.5 text-surface-muted hover:bg-surface-bg"
                  title="部署管理"
                >
                  🛠️
                </button>
                <button
                  onClick={() => setShowShares(true)}
                  className="rounded p-1.5 text-surface-muted hover:bg-surface-bg"
                  title="分享管理"
                >
                  🔗
                </button>
              </>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="rounded p-1.5 text-surface-muted hover:bg-surface-bg"
              title={t('app_bar.settings')}
            >
              ⚙️
            </button>
            <button
              onClick={lock}
              className="rounded p-1.5 text-surface-muted hover:bg-surface-bg"
              title={t('app_bar.lock')}
            >
              🔒
            </button>
          </div>
        </header>
        <Editor />
      </div>

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showShares && <SharesManager onClose={() => setShowShares(false)} />}
      {showAdmin && <AdminConfig onClose={() => setShowAdmin(false)} />}

      {updateCheck.result && updateCheck.result.status === 'ok' && updateCheck.result.manifest && (
        <UpdateBanner result={updateCheck.result} />
      )}
    </div>
  );
}

export default App;
