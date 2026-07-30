/**
 * IndexedDB 缓存层（基于 idb-keyval）
 *
 * 用于 Offline-first：缓存解密后的明文笔记、文件夹、标签，
 * 刷新页面或断网时仍能立即渲染 UI。
 *
 * 注意：
 * - 明文笔记缓存在浏览器本地 IndexedDB，相当于"已解锁"状态的副本。
 *   lock() 时不主动清空（保留便利性），logout 时 clearCache()。
 * - Map 需转为 [k,v][] 数组才能 JSON 序列化。
 */

import { get, set, del } from 'idb-keyval';
import type { Folder, NotePlaintext, NoteRow, Tag } from './store';

const KEYS = {
  notes: 'dustnote:notes',
  notesPlain: 'dustnote:notes-plain',
  folders: 'dustnote:folders',
  tags: 'dustnote:tags',
} as const;

// ========== 笔记（密文行 + 明文） ==========

export async function cacheNotes(
  notes: Map<string, NoteRow>,
  plain: Map<string, NotePlaintext>
): Promise<void> {
  // Map → [k,v][] 以便序列化；并行写入两条 key
  await Promise.all([
    set(KEYS.notes, Array.from(notes.entries())),
    set(KEYS.notesPlain, Array.from(plain.entries())),
  ]);
}

export async function loadCachedNotes(): Promise<{
  notes: Map<string, NoteRow>;
  plain: Map<string, NotePlaintext>;
}> {
  const [notesArr, plainArr] = await Promise.all([
    get<[string, NoteRow][]>(KEYS.notes),
    get<[string, NotePlaintext][]>(KEYS.notesPlain),
  ]);
  return {
    notes: notesArr ? new Map(notesArr) : new Map(),
    plain: plainArr ? new Map(plainArr) : new Map(),
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

// ========== 标签 ==========

export async function cacheTags(tags: Tag[]): Promise<void> {
  await set(KEYS.tags, tags);
}

export async function loadCachedTags(): Promise<Tag[]> {
  const tags = await get<Tag[]>(KEYS.tags);
  return tags ?? [];
}

// ========== 清空 ==========

export async function clearCache(): Promise<void> {
  await Promise.all([del(KEYS.notes), del(KEYS.notesPlain), del(KEYS.folders), del(KEYS.tags)]);
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
