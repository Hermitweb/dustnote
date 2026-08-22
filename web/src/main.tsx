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
// 但在可编辑元素（input/textarea/contenteditable）中保留右键菜单，
// 否则用户无法使用"剪切/复制/粘贴/全选"等编辑功能。
if (isTauri()) {
  const contextMenuHandler = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target &&
      (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
    ) {
      return; // 允许编辑元素的右键菜单
    }
    e.preventDefault();
  };
  window.addEventListener('contextmenu', contextMenuHandler, { capture: true });
  document.addEventListener('contextmenu', contextMenuHandler, { capture: true });
}

// 桌面端：拦截浏览器默认快捷键（Ctrl+O 打开文件、Ctrl+P 打印）
if (isTauri()) {
  window.addEventListener(
    'keydown',
    (e) => {
      // 防御：部分浏览器插件派发的合成事件没有 key 属性
      if ((e.ctrlKey || e.metaKey) && ['o', 'p'].includes(e.key?.toLowerCase() ?? '')) {
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
            <h2 className="mb-2 text-lg font-semibold text-surface-fg">应用遇到了问题</h2>
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

// 注册 Service Worker（仅生产环境 + HTTPS）
// 原先写在 index.html 的内联 <script> 里，会被 nginx CSP（script-src 'self'）拦截，故移到这里
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((err) => {
      console.warn('[SW] registration failed:', err);
    });
  });
}
