/**
 * 平台 / 环境检测工具
 *
 * main.tsx 在 React 渲染前调用，设置 dataset 并按环境注册全局事件拦截。
 * isTauri 与 lib/tauri.ts 中的实现一致（检测 window.__TAURI_INTERNALS__），
 * 此处独立导出以避免 main.tsx 引入 tauri.ts 中的 ApiClient 等非必要依赖。
 */

/** 是否运行在 Tauri 桌面 webview 中（而非普通浏览器） */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 是否为生产构建（Vite import.meta.env.PROD） */
export function isProduction(): boolean {
  return import.meta.env.PROD;
}
