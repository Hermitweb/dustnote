import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isTauri, isProduction } from './lib/platform';
import './index.css';

// 设置平台标识（供 CSS 选择器和 JS 判断使用）
document.documentElement.dataset.platform = isTauri() ? 'desktop' : 'web';
document.documentElement.dataset.env = isProduction() ? 'production' : 'development';

// 桌面端 + 生产环境：禁用浏览器默认右键菜单
if (isTauri() && isProduction()) {
  window.addEventListener('contextmenu', (e) => e.preventDefault(), { capture: true });
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

const root = document.getElementById('root');
if (!root) throw new Error('root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
