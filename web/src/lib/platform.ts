/**
 * 平台检测工具
 *
 * 统一判断当前运行环境（Tauri 桌面 / Web 浏览器），
 * 供快捷键、菜单、样式等模块使用。
 */

/** 检测当前是否运行在 Tauri 桌面环境 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 当前是否为生产环境（用于决定是否禁用右键菜单等） */
export function isProduction(): boolean {
  return import.meta.env.PROD;
}
