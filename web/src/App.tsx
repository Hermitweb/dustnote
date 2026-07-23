import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from './lib/store';
import { applyTheme, watchSystemTheme } from './lib/theme';
import { useUpdateCheck } from './lib/use-update-check';
import { ForceUpdateOverlay } from './components/ForceUpdateOverlay';
import { UpdateBanner } from './components/UpdateBanner';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { SettingsDialog } from './components/SettingsDialog';
import { SharesManager } from './components/SharesManager';
import { AdminConfig } from './components/AdminConfig';
import { SetupScreen } from './screens/SetupScreen';
import { UnlockScreen } from './screens/UnlockScreen';
import { PublicShareView } from './screens/PublicShareView';
import { startSyncWs, stopSyncWs } from './lib/sync-ws';
import { loadConfig } from './lib/config';
import './lib/i18n';

function App() {
  const { t } = useTranslation();
  const authState = useStore((s) => s.authState);
  const checkStatus = useStore((s) => s.checkStatus);
  const loadAll = useStore((s) => s.loadAll);
  const preferences = useStore((s) => s.preferences);
  const lock = useStore((s) => s.lock);
  const updateCheck = useUpdateCheck();

  const [showSettings, setShowSettings] = useState(false);
  const [showShares, setShowShares] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  // 启动：检查状态 + 加载配置
  useEffect(() => {
    void checkStatus();
    void loadConfig();
  }, [checkStatus, loadAll]);

  // 应用主题
  useEffect(() => {
    applyTheme(preferences.theme, preferences.mode);
    const cleanup = watchSystemTheme(preferences.theme, preferences.mode);
    return cleanup;
  }, [preferences.theme, preferences.mode]);

  // 解锁后加载数据 + 启动 WS
  useEffect(() => {
    if (authState === 'unlocked') {
      void loadAll();
      startSyncWs();
      return () => stopSyncWs();
    }
    return undefined;
  }, [authState, loadAll]);

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
  if (authState === 'uninitialized') return <SetupScreen />;
  if (authState === 'needs_unlock') return <UnlockScreen />;

  // 主界面
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        {/* 顶部操作条 */}
        <header className="flex items-center gap-2 border-b border-surface-border bg-surface-card px-4 py-2">
          <div className="text-sm text-surface-muted">{t('app.tagline')}</div>
          <div className="ml-auto flex items-center gap-2">
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
