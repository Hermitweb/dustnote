import { Suspense, lazy, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from './lib/store';
import type { ThemeId, Mode } from './lib/store';
import { useModeStore } from './lib/mode-store';
import { applyTheme, watchSystemTheme, applyTypography, THEMES } from './lib/theme';
import { useUpdateCheck } from './lib/use-update-check';
import { ForceUpdateOverlay } from './components/ForceUpdateOverlay';
import { UpdateBanner } from './components/UpdateBanner';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { SetupScreen } from './screens/SetupScreen';
import { UnlockScreen } from './screens/UnlockScreen';
import { StandaloneSetupScreen } from './screens/StandaloneSetupScreen';
import { StandaloneUnlockScreen } from './screens/StandaloneUnlockScreen';
import { StandaloneRecoverScreen } from './screens/StandaloneRecoverScreen';
import { PublicShareView } from './screens/PublicShareView';
import { startSyncWs, stopSyncWs } from './lib/sync-ws';
import { toast } from './lib/toast';
import { isPlainHttp } from './lib/env';
import { loadConfig } from './lib/config';
import { installOnlineListener } from './lib/online-listener';
import { useKeyboardShortcuts } from './lib/use-keyboard-shortcuts';
import './lib/i18n';
import { ToastContainer } from './components/ToastContainer';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { QuickCapture } from './components/QuickCapture';
import { Logo } from './components/Logo';

// React.lazy 惰性加载重对话框（首屏不依赖，减少主 bundle 体积）
const SettingsDialog = lazy(() => import('./components/SettingsDialog').then((m) => ({ default: m.SettingsDialog })));
const SharesManager = lazy(() => import('./components/SharesManager').then((m) => ({ default: m.SharesManager })));
const AdminConfig = lazy(() => import('./components/AdminConfig').then((m) => ({ default: m.AdminConfig })));
const ImportExportDialog = lazy(() => import('./components/ImportExportDialog').then((m) => ({ default: m.ImportExportDialog })));
const ModeSelectDialog = lazy(() => import('./components/ModeSelectDialog').then((m) => ({ default: m.ModeSelectDialog })));
const Cheatsheet = lazy(() => import('./components/Cheatsheet').then((m) => ({ default: m.Cheatsheet })));
const CommandPalette = lazy(() => import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette })));
const AboutDialog = lazy(() => import('./components/AboutDialog').then((m) => ({ default: m.AboutDialog })));
const ConflictDialog = lazy(() => import('./components/ConflictDialog').then((m) => ({ default: m.ConflictDialog })));

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
  const sidebarHidden = useStore((s) => s.sidebarHidden);
  const toggleSidebar = useStore((s) => s.toggleSidebar);

  const [showSettings, setShowSettings] = useState(false);
  const [showShares, setShowShares] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showQuickCapture, setShowQuickCapture] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [standaloneView, setStandaloneView] = useState<StandaloneView>('setup');

  // 应用内快捷键（仅 unlocked 状态生效）
  useKeyboardShortcuts(authState);

  // 监听快捷键/菜单触发的打开设置事件
  useEffect(() => {
    const openSettings = () => setShowSettings(true);
    const openQuickCapture = () => setShowQuickCapture(true);
    window.addEventListener('app:open-settings', openSettings);
    window.addEventListener('app:quick-capture', openQuickCapture);
    return () => {
      window.removeEventListener('app:open-settings', openSettings);
      window.removeEventListener('app:quick-capture', openQuickCapture);
    };
  }, []);

  // 监听命令面板派发的命令事件（CommandPalette 通过 window 自定义事件触发命令执行）
  useEffect(() => {
    const newNote = () => {
      void useStore.getState().createNote();
    };
    const doLock = () => {
      useStore.getState().lock();
    };
    const openShares = () => setShowShares(true);
    const openImportExport = () => setShowImportExport(true);
    const toggleTheme = () => {
      const prefs = useStore.getState().preferences;
      const ids = THEMES.map((th) => th.id);
      const idx = ids.indexOf(prefs.theme);
      const next: ThemeId = ids[(idx + 1) % ids.length] ?? 'mint-dawn';
      useStore.getState().setTheme(next);
    };
    const toggleMode = () => {
      const prefs = useStore.getState().preferences;
      // auto → 先解析为当前系统偏好，再切换到相反
      const effective: Mode =
        prefs.mode === 'auto'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : prefs.mode;
      const next: Mode = effective === 'dark' ? 'light' : 'dark';
      useStore.getState().setMode(next);
    };
    const about = () => {
      setShowAbout(true);
    };

    window.addEventListener('app:new-note', newNote);
    window.addEventListener('app:lock', doLock);
    window.addEventListener('app:open-shares', openShares);
    window.addEventListener('app:import-export', openImportExport);
    window.addEventListener('app:toggle-theme', toggleTheme);
    window.addEventListener('app:toggle-mode', toggleMode);
    window.addEventListener('app:about', about);

    return () => {
      window.removeEventListener('app:new-note', newNote);
      window.removeEventListener('app:lock', doLock);
      window.removeEventListener('app:open-shares', openShares);
      window.removeEventListener('app:import-export', openImportExport);
      window.removeEventListener('app:toggle-theme', toggleTheme);
      window.removeEventListener('app:toggle-mode', toggleMode);
      window.removeEventListener('app:about', about);
    };
  }, [t]);

  // 移动端响应式：窄屏（< sm 断点 640px）默认收起 sidebar，给编辑器留出全宽
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 639px)').matches) {
      useStore.setState({ sidebarHidden: true });
    }
  }, []);

  // 启动：检查模式 + 初始化 Repository + 检查状态 + 加载配置
  useEffect(() => {
    if (!modeInitialized) return;
    initRepository();
    void checkStatus();
    void loadConfig();
    installOnlineListener();
  }, [checkStatus, loadAll, modeInitialized, initRepository]);

  // 应用主题 + 排版（字体 / 行高密度）
  useEffect(() => {
    applyTheme(preferences.theme, preferences.mode);
    applyTypography(preferences.font, preferences.density);
    const cleanup = watchSystemTheme(preferences.theme, preferences.mode);
    return cleanup;
  }, [preferences.theme, preferences.mode, preferences.font, preferences.density]);

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

  // HTTP 直连（非安全上下文）环境提示：一次性 toast，localStorage 标记避免重复打扰。
  // 端到端加密/同步/复制不受影响（已内置降级）；受限的是 PWA 离线、读剪贴板、语音输入。
  useEffect(() => {
    if (authState !== 'unlocked' || !isPlainHttp) return;
    const KEY = 'dustnote_http_env_notice_shown';
    try {
      if (localStorage.getItem(KEY)) return;
      localStorage.setItem(KEY, '1');
    } catch {
      /* localStorage 不可用时仅提示一次（本次会话） */
    }
    toast.info(t('env.http_notice'));
  }, [authState, t]);

  // 安全（§1.5/§3.3/§3.6）：
  // - 空闲 N 分钟自动锁屏（preferences.autoLock，0 = 关闭）
  // - pagehide（含 bfcache 冻结）时清空内存中的 masterKey，防止冻结页泄露密钥
  const [pageHidden, setPageHidden] = useState(false);
  useEffect(() => {
    if (authState !== 'unlocked') return;

    // 空闲自动锁屏
    let idleTimer: number | null = null;
    const idleMs = (preferences.autoLock || 0) * 60_000;
    const resetIdle = () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = idleMs > 0 ? window.setTimeout(() => useStore.getState().lock(), idleMs) : null;
    };
    const IDLE_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;
    if (idleMs > 0) {
      IDLE_EVENTS.forEach((e) => window.addEventListener(e, resetIdle, { passive: true }));
      resetIdle();
    }

    // pagehide：浏览器关闭 / 页面被 bfcache 冻结 / 移动端切后台时，清空内存密钥
    const onPageHide = () => useStore.getState().lock();
    window.addEventListener('pagehide', onPageHide);

    return () => {
      IDLE_EVENTS.forEach((e) => window.removeEventListener(e, resetIdle));
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [authState, preferences.autoLock]);

  // visibilitychange：页面切到后台时显示全屏遮挡层（防任务切换预览/截图泄露内容，§3.6）
  useEffect(() => {
    const onVis = () => setPageHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

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
    return <Suspense fallback={null}><ModeSelectDialog /></Suspense>;
  }

  // 认证流程
  if (authState === 'unknown') {
    return (
      <div className="flex h-full items-center justify-center bg-surface-bg text-surface-muted">
        <div className="text-center">
          <div className="mb-2 text-3xl">
            <Logo className="mx-auto h-10 w-10" />
          </div>
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
          <p className="mb-1 text-sm text-surface-muted">请确认服务器已启动且地址正确。</p>
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
        return <StandaloneRecoverScreen onBack={() => setStandaloneView('unlock')} />;
      }
      return <StandaloneUnlockScreen onRecover={() => setStandaloneView('recover')} />;
    }
  } else {
    // 联机模式鉴权流程
    if (authState === 'uninitialized') return <SetupScreen />;
    if (authState === 'needs_unlock') return <UnlockScreen />;
  }

  // 主界面
  return (
    <div className="flex h-full overflow-hidden">
      {/* 跳过导航链接（屏幕阅读器/键盘用户） */}
      <a
        href="#main-content"
        className="sr-only sr-only-focusable fixed left-2 top-2 z-[10000] rounded-lg bg-mint-600 px-4 py-2 text-sm font-medium text-white shadow-lg focus:not-sr-only"
      >
        {t('app.skip_to_content') || '跳转到主要内容'}
      </a>
      {/* 页面隐藏时全屏遮挡（§3.6），防任务切换预览/截图泄露笔记内容 */}
      {pageHidden && <div className="fixed inset-0 z-[9999] bg-surface-bg" aria-hidden="true" />}
      {!sidebarHidden && <Sidebar />}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* 顶部操作条 */}
        <header className="flex items-center gap-2 border-b border-surface-border bg-surface-card px-4 py-2">
          {/* 移动端汉堡按钮：切换 sidebar 抽屉 */}
          <button
            onClick={() => toggleSidebar()}
            className="rounded p-1.5 text-surface-muted hover:bg-surface-bg sm:hidden"
            aria-label={t('app_bar.toggle_sidebar')}
            aria-expanded={!sidebarHidden}
          >
            ☰
          </button>
          <div className="hidden text-sm text-surface-muted sm:block">{t('app.tagline')}</div>
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
                  title={t('admin.title')}
                  aria-label={t('admin.title')}
                >
                  🛠️
                </button>
                <button
                  onClick={() => setShowShares(true)}
                  className="rounded p-1.5 text-surface-muted hover:bg-surface-bg"
                  title={t('shares.title')}
                  aria-label={t('shares.title')}
                >
                  🔗
                </button>
              </>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="rounded p-1.5 text-surface-muted hover:bg-surface-bg"
              title={t('app_bar.settings')}
              aria-label={t('app_bar.settings')}
            >
              ⚙️
            </button>
            <button
              onClick={lock}
              className="rounded p-1.5 text-surface-muted hover:bg-surface-bg"
              title={t('app_bar.lock')}
              aria-label={t('app_bar.lock')}
            >
              🔒
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
          <Editor />
        </main>
      </div>

      {showSettings && <Suspense fallback={null}><SettingsDialog onClose={() => setShowSettings(false)} /></Suspense>}
      {showShares && <Suspense fallback={null}><SharesManager onClose={() => setShowShares(false)} /></Suspense>}
      {showAdmin && <Suspense fallback={null}><AdminConfig onClose={() => setShowAdmin(false)} /></Suspense>}
      {showImportExport && <Suspense fallback={null}><ImportExportDialog onClose={() => setShowImportExport(false)} /></Suspense>}

      <Suspense fallback={null}><Cheatsheet /></Suspense>

      {updateCheck.result && updateCheck.result.status === 'ok' && updateCheck.result.manifest && (
        <UpdateBanner result={updateCheck.result} />
      )}

      <Suspense fallback={null}><CommandPalette /></Suspense>

      {showQuickCapture && <QuickCapture onClose={() => setShowQuickCapture(false)} />}

      {showAbout && <Suspense fallback={null}><AboutDialog onClose={() => setShowAbout(false)} /></Suspense>}

      {/* 同步冲突裁决（pendingConflicts 非空时展示） */}
      <Suspense fallback={null}><ConflictDialog /></Suspense>

      <ToastContainer />
    </div>
  );
}

/**
 * 带错误边界的 App 包装
 * 捕获渲染异常，避免白屏，提供错误码 + 诊断导出
 */
function AppWithBoundary() {
  return (
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
}

export default AppWithBoundary;
