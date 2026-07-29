/**
 * 轻量 Toast 通知系统
 *
 * 替代 alert() 的非阻塞通知：
 * - success：3 秒自动消失
 * - error：5 秒自动消失（错误需更多阅读时间）
 * - info：3 秒自动消失
 *
 * 基于 zustand，无需 Provider 包裹；任意位置 import { toast } 即可调用。
 * 容器组件 <ToastContainer /> 需在 App 顶层挂载一次。
 */

import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastStore {
  toasts: ToastItem[];
  show: (kind: ToastKind, message: string, duration?: number) => void;
  dismiss: (id: number) => void;
}

let nextId = 0;

export const useToast = create<ToastStore>((set) => ({
  toasts: [],
  show: (kind, message, duration) => {
    const id = ++nextId;
    const ttl = duration ?? (kind === 'error' ? 5000 : 3000);
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, ttl);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** 命令式 API：任意位置调用，无需 hook 上下文 */
export const toast = {
  success: (message: string): void => useToast.getState().show('success', message),
  error: (message: string): void => useToast.getState().show('error', message),
  info: (message: string): void => useToast.getState().show('info', message),
};
