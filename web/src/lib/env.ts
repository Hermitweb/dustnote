/**
 * 运行环境能力检测（集中管理）
 *
 * 背景：大量 Web API 仅在「安全上下文」（HTTPS / localhost）可用。
 * 用户经 http://<公网IP> 直连自托管部署时，这些 API 是 undefined，
 * 直接调用会抛 TypeError（历史教训：v2.5.9 修复 crypto.randomUUID、
 * v2.5.10 修复 navigator.clipboard.writeText，均为该场景崩溃）。
 *
 * 本模块集中暴露环境能力，调用方按能力降级，避免检测逻辑散落各处：
 * - 写剪贴板：copyText()（lib/clipboard.ts）已内置 execCommand 降级
 * - 读剪贴板：无降级方案，需按 canReadClipboard 预检并提示
 * - Service Worker（PWA 离线）：按 canRegisterServiceWorker 预检
 * - 加密/随机数：shared/crypto.ts 已内置 @noble 纯 JS 降级
 */

/** 是否安全上下文（HTTPS / localhost） */
export const isSecureContext: boolean =
  typeof window !== 'undefined' && window.isSecureContext === true;

/**
 * 是否经明文 HTTP 直连公网地址（非 localhost）。
 * 该环境下浏览器功能受限：PWA 离线、读剪贴板、Web Speech 等
 * 不可用；写入剪贴板与随机 UUID 已内置降级，功能不受影响。
 */
export const isPlainHttp: boolean =
  typeof window !== 'undefined' &&
  location.protocol === 'http:' &&
  !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/** 剪贴板读取（安全上下文专属，无降级方案） */
export const canReadClipboard: boolean =
  typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

/** Service Worker / PWA 离线注册（需安全上下文） */
export const canRegisterServiceWorker: boolean =
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && isSecureContext;
