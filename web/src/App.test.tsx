/**
 * web/src/App.tsx 单测
 *
 * App 是根组件，依赖极重（lazy 对话框、store、mode-store、theme、effect、sync-ws、
 * 多个 screens）。这里 mock 掉外部副作用模块，按 authState 路由分支验证渲染到的
 * 顶层 UI：locked（UnlockScreen）/ needs_setup（SetupScreen）/ standalone setup/unlock/
 * recover / online unlocked（Sidebar + Stage 主布局）/ 更新检查状态 / 强制更新 overlay。
 *
 * 时序脆弱分支撤项（留 E2E）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from './test/render';

// jsdom 无 matchMedia：App.tsx L190 useEffect 调 window.matchMedia（响应式布局）
// 提供最小 polyfill（matches=false → 不自动 hide sidebar）
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const H = vi.hoisted(() => ({
  storeState: {
    authState: 'unlocked',
    serverError: null,
    mode: 'online',
    checkStatus: 'idle',
    loadAll: vi.fn(),
    preferences: {},
    lock: vi.fn(),
    initRepository: vi.fn(),
    refreshPendingCount: vi.fn(),
    sidebarHidden: false,
    toggleSidebar: vi.fn(),
  } as Record<string, unknown>,
  isTauri: false,
  themeApply: vi.fn(),
  themeWatch: vi.fn(),
  typographyApply: vi.fn(),
  effectApply: vi.fn(),
  updateCheck: { status: 'idle', latestVersion: null, forceUpdate: null, checkNow: vi.fn() },
  startSyncWs: vi.fn(),
  stopSyncWs: vi.fn(),
  installOnlineListener: vi.fn(),
  keyboardShortcuts: vi.fn(),
  loadConfig: vi.fn().mockResolvedValue({}),
  isPlainHttp: vi.fn().mockReturnValue(false),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// 副作用模块 mock（不真跑）
vi.mock('./lib/platform', () => ({ isTauri: () => H.isTauri, isProduction: () => false }));
vi.mock('./lib/theme', () => ({
  applyTheme: (a: unknown, b: unknown) => H.themeApply(a, b),
  watchSystemTheme: () => H.themeWatch(),
  applyTypography: () => H.typographyApply(),
  THEMES: { light: {}, dark: {} },
}));
vi.mock('./lib/effect', () => ({ applyEffect: () => H.effectApply() }));
vi.mock('./lib/use-update-check', () => ({ useUpdateCheck: () => H.updateCheck }));
vi.mock('./lib/sync-ws', () => ({
  startSyncWs: () => H.startSyncWs(),
  stopSyncWs: () => H.stopSyncWs(),
}));
vi.mock('./lib/online-listener', () => ({
  installOnlineListener: () => H.installOnlineListener(),
}));
vi.mock('./lib/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: () => H.keyboardShortcuts(),
}));
vi.mock('./lib/config', () => ({ loadConfig: () => H.loadConfig() }));
vi.mock('./lib/env', () => ({ isPlainHttp: () => H.isPlainHttp() }));
vi.mock('./lib/toast', () => ({ toast: H.toast }));
vi.mock('./lib/i18n', () => ({}));

// store：selector 风格 + getState + setState（App 在 matchMedia effect 里调 setState）
// selector 形参必须声明成函数类型：写成 unknown 时 TS 判为「不可调用」。
vi.mock('./lib/store', () => ({
  useStore: Object.assign(
    (sel?: (state: Record<string, unknown>) => unknown) => (sel ? sel(H.storeState) : H.storeState),
    {
      getState: () => H.storeState,
      setState: (p: Record<string, unknown>) => Object.assign(H.storeState, p),
    }
  ),
}));

// mode-store：selector + getState
type ModeState = { initialized: boolean; serverUrl: string; mode: string };
const modeState: ModeState = { initialized: true, serverUrl: '', mode: 'online' };
vi.mock('./lib/mode-store', () => ({
  useModeStore: Object.assign(
    (sel?: (state: ModeState) => unknown) => (sel ? sel(modeState) : modeState),
    {
      getState: () => modeState,
      setState: (p: unknown) => Object.assign(modeState, p),
    }
  ),
  hasModeDefaultApplied: () => true,
  markModeDefaultApplied: vi.fn(),
}));

// i18n：稳定 t 引用（避免 useEffect 无限重触发）
const t = (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdparty', init: () => {} },
  i18n: { use: () => ({ init: () => Promise.resolve() }) },
  useTranslation: () => ({
    t,
    i18n: { language: 'zh-CN', changeLanguage: () => Promise.resolve() },
  }),
}));

// lazy 对话框 / screens / 主布局子组件：轻 mock 避免真实依赖链
vi.mock('./components/Sidebar', () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock('./components/Stage', () => ({ Stage: () => <div data-testid="stage" /> }));
vi.mock('./components/StatePlate', () => ({
  StatePlate: ({ title }: { title: unknown }) => (
    <div data-testid="state-plate">{String(title ?? '')}</div>
  ),
  CARD_BTN_PRIMARY: 'p',
  CARD_BTN_SECONDARY: 's',
}));
vi.mock('./components/ForceUpdateOverlay', () => ({
  ForceUpdateOverlay: () => <div data-testid="force-update" />,
}));
vi.mock('./components/UpdateBanner', () => ({ UpdateBanner: () => null }));
vi.mock('./components/ToastContainer', () => ({ ToastContainer: () => null }));
vi.mock('./components/AppErrorBoundary', () => ({
  AppErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./components/QuickCapture', () => ({ QuickCapture: () => null }));
vi.mock('./components/Logo', () => ({ Logo: () => <div data-testid="logo" /> }));
vi.mock('./components/ScopeTitle', () => ({ ScopeTitle: () => null }));
vi.mock('./components/Icon', () => ({ Icon: () => null, IconText: () => null }));
vi.mock('./screens/SetupScreen', () => ({ SetupScreen: () => <div data-testid="setup-screen" /> }));
vi.mock('./screens/UnlockScreen', () => ({
  UnlockScreen: () => <div data-testid="unlock-screen" />,
}));
vi.mock('./screens/StandaloneSetupScreen', () => ({
  StandaloneSetupScreen: () => <div data-testid="standalone-setup" />,
}));
vi.mock('./screens/StandaloneUnlockScreen', () => ({
  StandaloneUnlockScreen: () => <div data-testid="standalone-unlock" />,
}));
vi.mock('./screens/StandaloneRecoverScreen', () => ({
  StandaloneRecoverScreen: () => <div data-testid="standalone-recover" />,
}));
vi.mock('./screens/PublicShareView', () => ({
  PublicShareView: () => <div data-testid="public-share" />,
}));
// FocusLock 在 jsdom 下重，mock 成透传
vi.mock('react-focus-lock', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// 对话框类 lazy（按需渲染时命中），mock 成不触发真实 import
vi.mock('./components/SettingsDialog', () => ({ SettingsDialog: () => null }));
vi.mock('./components/SharesManager', () => ({ SharesManager: () => null }));
vi.mock('./components/AdminConfig', () => ({ AdminConfig: () => null }));
vi.mock('./components/ImportExportDialog', () => ({ ImportExportDialog: () => null }));
vi.mock('./components/ModeSelectDialog', () => ({ ModeSelectDialog: () => null }));
vi.mock('./components/Cheatsheet', () => ({ Cheatsheet: () => null }));
vi.mock('./components/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./components/AboutDialog', () => ({ AboutDialog: () => null }));
vi.mock('./components/ConflictDialog', () => ({ ConflictDialog: () => null }));

import App from './App';

function setStore(patch: Record<string, unknown>) {
  Object.assign(H.storeState, patch);
}

function resetStore() {
  Object.assign(H.storeState, {
    authState: 'unlocked',
    serverError: null,
    mode: 'online',
    checkStatus: vi.fn().mockResolvedValue(undefined),
    loadAll: vi.fn().mockResolvedValue(undefined),
    preferences: {},
    lock: vi.fn(),
    initRepository: vi.fn(),
    refreshPendingCount: vi.fn(),
    sidebarHidden: false,
    toggleSidebar: vi.fn(),
    ensureDefaultContent: vi.fn().mockResolvedValue(undefined),
  });
}

describe('App 路由与渲染', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    H.isTauri = false;
    H.updateCheck = { status: 'idle', latestVersion: null, forceUpdate: null, checkNow: vi.fn() };
  });

  it('联机 unlocked → 渲染 Sidebar + Stage 主布局', async () => {
    setStore({ authState: 'unlocked', mode: 'online' });
    const { unmount, container } = render(<App />);
    await vi.waitFor(
      () => {
        expect(container.querySelector('[data-testid="sidebar"]')).toBeTruthy();
        expect(container.querySelector('[data-testid="stage"]')).toBeTruthy();
      },
      { timeout: 4000, interval: 20 }
    );
    unmount();
  });

  it('locked → 渲染 UnlockScreen', async () => {
    setStore({ authState: 'needs_unlock', mode: 'online' });
    const { unmount, container } = render(<App />);
    await vi.waitFor(
      () => {
        expect(container.querySelector('[data-testid="unlock-screen"]')).toBeTruthy();
      },
      { timeout: 4000, interval: 20 }
    );
    unmount();
  });

  it('needs_setup → 渲染 SetupScreen', async () => {
    setStore({ authState: 'uninitialized', mode: 'online' });
    const { unmount, container } = render(<App />);
    await vi.waitFor(
      () => {
        expect(container.querySelector('[data-testid="setup-screen"]')).toBeTruthy();
      },
      { timeout: 4000, interval: 20 }
    );
    unmount();
  });

  it('standalone unlocked → 主布局（无服务器错误）', async () => {
    setStore({ authState: 'unlocked', mode: 'standalone' });
    const { unmount, container } = render(<App />);
    await vi.waitFor(
      () => {
        expect(container.querySelector('[data-testid="sidebar"]')).toBeTruthy();
      },
      { timeout: 4000, interval: 20 }
    );
    unmount();
  });

  it('standalone locked → 单机解锁屏', async () => {
    setStore({ authState: 'needs_unlock', mode: 'standalone' });
    const { unmount, container } = render(<App />);
    await vi.waitFor(
      () => {
        // 单机模式下 needs_unlock 渲染 StandaloneUnlockScreen
        expect(container.querySelector('[data-testid="standalone-unlock"]')).toBeTruthy();
      },
      { timeout: 4000, interval: 20 }
    );
    unmount();
  });
});
