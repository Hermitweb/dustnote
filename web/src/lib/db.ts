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
