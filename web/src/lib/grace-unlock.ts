/**
 * 桌面端免密解锁宽限期（S-1 懒人化体验）
 *
 * 作用：lock() 时把 masterKey 副本保留在内存中 N 分钟，
 * 在宽限期内可一键恢复 unlocked 状态，免去重复输入主密码。
 *
 * 边界与安全：
 * - 仅存在于模块级内存变量，不持久化到磁盘；进程退出即丢失
 * - Web 端默认关闭（标签关闭即丢失，意义不大）；桌面端默认 30 分钟
 * - 偏好存储在 localStorage 独立 key，不进 Preferences schema（避免与服务端同步冲突）
 * - 切换模式 / 注销时需主动 clearGraceUnlock()
 *
 * 适用场景：临时锁定（Ctrl+L）、自动锁定后短时间返回
 */

import type { Ciphertext } from '@dustnote/shared';

const PREF_KEY = 'dustnote_grace_unlock_min';
const DEFAULT_DESKTOP_MIN = 30;

interface GraceCache {
  masterKey: Uint8Array;
  wrappedMasterKey: Ciphertext | null;
  expiresAt: number;
}

let cache: GraceCache | null = null;

/** 读取宽限期偏好（分钟，0=关闭） */
export function getGraceUnlockMin(): number {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw !== null) return Number.parseInt(raw, 10) || 0;
  } catch {
    /* localStorage 不可用 */
  }
  // 默认：桌面端 30 分钟，Web 端关闭
  return isTauriEnv() ? DEFAULT_DESKTOP_MIN : 0;
}

export function setGraceUnlockMin(min: number): void {
  const v = Math.max(0, Math.min(120, Math.floor(min)));
  try {
    localStorage.setItem(PREF_KEY, String(v));
  } catch {
    /* ignore */
  }
  if (v === 0) clearGraceUnlock();
}

/** 是否启用宽限期 */
export function isGraceUnlockEnabled(): boolean {
  return getGraceUnlockMin() > 0;
}

/** lock() 时调用：若启用则缓存 masterKey 副本 */
export function enableGraceUnlock(
  masterKey: Uint8Array,
  wrappedMasterKey: Ciphertext | null,
  minutes: number
): void {
  if (minutes <= 0) {
    clearGraceUnlock();
    return;
  }
  // 深拷贝 masterKey，避免原 buffer fill(0) 后影响副本
  const copy = new Uint8Array(masterKey.length);
  copy.set(masterKey);
  cache = {
    masterKey: copy,
    wrappedMasterKey,
    expiresAt: Date.now() + minutes * 60_000,
  };
}

/** 检查宽限期是否仍有效（未过期） */
export function peekGraceUnlock(): boolean {
  if (!cache) return false;
  if (Date.now() >= cache.expiresAt) {
    clearGraceUnlock();
    return false;
  }
  return true;
}

/** 剩余宽限期秒数（用于 UI 展示） */
export function graceRemainingSec(): number {
  if (!cache) return 0;
  return Math.max(0, Math.ceil((cache.expiresAt - Date.now()) / 1000));
}

/**
 * 消费宽限期缓存：成功返回 masterKey 副本，失败返回 null
 * 注意：调用后即清空，确保一次性使用
 */
export function consumeGraceUnlock(): {
  masterKey: Uint8Array;
  wrappedMasterKey: Ciphertext | null;
} | null {
  if (!peekGraceUnlock()) {
    clearGraceUnlock();
    return null;
  }
  const result = { masterKey: cache!.masterKey, wrappedMasterKey: cache!.wrappedMasterKey };
  cache = null;
  return result;
}

/** 立即清空宽限期缓存（切换模式 / 注销 / 主动关闭时调用） */
export function clearGraceUnlock(): void {
  if (cache) {
    cache.masterKey.fill(0);
    cache = null;
  }
}

function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
