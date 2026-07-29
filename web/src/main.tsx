import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isTauri, isProduction } from './lib/platform';
import { initSentry, captureException, Sentry } from './lib/sentry';
import './index.css';

// Sentry 初始化（必须在 React 渲染之前；未配置 DSN 时为 no-op）
initSentry();

// 设置平台标识（供 CSS 选择器和 JS 判断使用）
document.documentElement.dataset.platform = isTauri() ? 'desktop' : 'web';
document.documentElement.dataset.env = isProduction() ? 'production' : 'development';

// 桌面端：禁用浏览器/webview 默认右键菜单（生产+开发环境均禁用，让应用更像原生软件）
if (isTauri()) {
  window.addEventListener('contextmenu', (e) => e.preventDefault(), { capture: true });
  document.addEventListener('contextmenu', (e) => e.preventDefault(), { capture: true });
}

// 桌面端：拦截浏览器默认快捷键（Ctrl+O 打开文件、Ctrl+P 打印）
if (isTauri()) {
  window.addEventListener(
    'keydown',
    (e) => {
      if ((e.ctrlKey || e.metaKey) && ['o', 'p'].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    },
    { capture: true }
  );
}

// 全局未捕获错误 & Promise 拒绝 → Sentry（未初始化时 captureException 为 no-op）
window.addEventListener('error', (e) => {
  captureException(e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  captureException(e.reason);
});

const root = document.getElementById('root');
if (!root) throw new Error('root element not found');

createRoot(root).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={({ error }) => (
        <div className="flex h-full items-center justify-center bg-surface-bg p-6">
          <div className="w-full max-w-md rounded-2xl border border-surface-border bg-surface-card p-8 text-center shadow-xl">
            <div className="mb-4 text-4xl">💥</div>
            <h2 className="mb-2 text-lg font-semibold text-surface-fg">
              应用遇到了问题
            </h2>
            <p className="mb-4 text-sm text-surface-muted">
              {import.meta.env.PROD
                ? '错误已自动上报，请刷新页面或重启应用。'
                : (error as Error).message}
            </p>
            <button
              onClick={() => location.reload()}
              className="rounded-lg bg-mint-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mint-700"
            >
              重新加载
            </button>
          </div>
        </div>
      )}
    >
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>
);
