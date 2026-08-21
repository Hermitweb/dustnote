/**
 * IndexedDB 缓存层（基于 idb-keyval）
 *
 * 用于 Offline-first：缓存笔记、文件夹、标签，刷新页面或断网时仍能立即渲染 UI。
 *
 * 安全（security.md §3.4：Web IndexedDB 用 masterKey 派生 localDEK 加密）：
 * - 密文行（notes）本身是密文，可直接缓存；
 * - 明文（notesPlain）必须用 localDEK（由 masterKey 经 HKDF 派生）加密后落盘，
 *   调用方在解锁后传入 localKey；无密钥时不落明文。
 * - lock() 时调用 clearPlainCache() 清掉明文缓存，仅保留密文行加速下次解锁加载。
 */

import { get, set, del } from 'idb-keyval';
import { encryptString, decryptString, isCiphertext, type Ciphertext } from '@dustnote/shared';
import type { Folder, NotePlaintext, NoteRow } from './store';

const KEYS = {
  notes: 'dustnote:notes',
  notesPlain: 'dustnote:notes-plain',
  folders: 'dustnote:folders',
} as const;

// ========== 笔记（密文行 + 明文） ==========

/**
 * 缓存笔记。密文行直接存储；明文仅在提供 localKey 时加密存储，
 * 无 localKey 时清除旧明文缓存（不落明文）。
 */
export async function cacheNotes(
  notes: Map<string, NoteRow>,
  plain: Map<string, NotePlaintext>,
  localKey?: Uint8Array
): Promise<void> {
  const writes: Promise<unknown>[] = [set(KEYS.notes, Array.from(notes.entries()))];
  if (localKey) {
    const json = JSON.stringify(Array.from(plain.entries()));
    const blob = await encryptString(localKey, json, 1);
    writes.push(set(KEYS.notesPlain, blob));
  } else {
    writes.push(del(KEYS.notesPlain));
  }
  await Promise.all(writes);
}

/**
 * 读取缓存。明文缓存是 localDEK 加密的 Ciphertext，需 localKey 解密；
 * 无密钥或解密失败（密钥不匹配 / 旧明文格式）时返回空明文（不降级为明文泄露）。
 */
export async function loadCachedNotes(
  localKey?: Uint8Array
): Promise<{
  notes: Map<string, NoteRow>;
  plain: Map<string, NotePlaintext>;
}> {
  const [notesArr, plainBlob] = await Promise.all([
    get<[string, NoteRow][]>(KEYS.notes),
    get<Ciphertext | [string, NotePlaintext][]>(KEYS.notesPlain),
  ]);
  let plain: Map<string, NotePlaintext> = new Map();
  if (localKey && plainBlob && isCiphertext(plainBlob)) {
    try {
      const json = await decryptString(localKey, plainBlob);
      plain = new Map(JSON.parse(json) as [string, NotePlaintext][]);
    } catch {
      // 密钥不匹配或数据损坏：放弃明文缓存（安全优先，绝不降级为明文）
      plain = new Map();
    }
  }
  return {
    notes: notesArr ? new Map(notesArr) : new Map(),
    plain,
  };
}

// ========== 文件夹 ==========

export async function cacheFolders(folders: Folder[]): Promise<void> {
  await set(KEYS.folders, folders);
}

export async function loadCachedFolders(): Promise<Folder[]> {
  const folders = await get<Folder[]>(KEYS.folders);
  return folders ?? [];
}

// ========== 清空 ==========

export async function clearCache(): Promise<void> {
  await Promise.all([del(KEYS.notes), del(KEYS.notesPlain), del(KEYS.folders)]);
}

/** 锁定/登出时清掉明文缓存（保留密文行，加速下次解锁加载） */
export async function clearPlainCache(): Promise<void> {
  await del(KEYS.notesPlain);
}

// ========== 容量监控（P0-1 防坑：IndexedDB 无限增长会导致 QuotaExceededError） ==========

/**
 * 获取 IndexedDB 存储用量估算
 * @returns usage(bytes) / quota(bytes) / usagePercent(0-100)
 */
export async function getStorageUsage(): Promise<{
  usage: number;
  quota: number;
  usagePercent: number;
}> {
  if (!navigator.storage?.estimate) {
    return { usage: 0, quota: 0, usagePercent: 0 };
  }
  const est = await navigator.storage.estimate();
  const usage = est.usage ?? 0;
  const quota = est.quota ?? 0;
  return {
    usage,
    quota,
    usagePercent: quota > 0 ? Math.round((usage / quota) * 100) : 0,
  };
}

/**
 * 轻量清理：只清离线队列和旧的笔记明文缓存，保留笔记本身
 * 用于设置页"清理缓存"按钮
 */
export async function cleanupCache(): Promise<{ cleared: string[] }> {
  const cleared: string[] = [];
  // 离线队列（失败请求重试数据）
  const { clear } = await import('./offline-queue');
  await clear();
  cleared.push('offline-queue');
  // 诊断日志（保留最近 1000 条，这里只清旧的）
  const { clearLogs } = await import('./diagnostics');
  await clearLogs();
  cleared.push('diagnostics');
  // 旧自动备份（保留最近 3 份）
  const { clearAutoBackups } = await import('./auto-backup');
  await clearAutoBackups();
  cleared.push('auto-backups');
  return { cleared };
}
