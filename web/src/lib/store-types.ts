/**
 * Store 类型定义（从 store.ts 提取）
 *
 * 所有共享类型集中在此，避免循环依赖。
 */

import type { NoteCipherEnvelope, MergeableNote, FieldConflict } from '@dustnote/client-core';

export type { NoteCipherEnvelope };

export interface NoteRow {
  id: string;
  ciphertext: string;
  keyVersion: number;
  isPinned: boolean;
  isFavorite: boolean;
  deletedAt: string | null;
  version: number;
  clientUpdatedAt: string;
  serverUpdatedAt: string;
  folderId: string | null;
}

export interface NotePlaintext {
  title: string;
  content: string;
  tags: string[];
}

/**
 * 「未分类」虚拟节点 id（H8）：folderId=null 的笔记在文件夹树的入口。
 * 不存在于 folders 表——**任何写路径收到它必须先归一为 null**
 * （H-A 回归教训：曾泄漏进 createNote 落库成不可见笔记）。
 */
export const UNFILED_ID = '__unfiled__';

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
  depth?: number;
  branch?: 'work' | 'personal' | null;
}

export type AuthState = 'unknown' | 'uninitialized' | 'needs_unlock' | 'unlocked' | 'error';
/**
 * 导航轨的目的地（舞台状态机的输入，见 web/src/lib/stage.ts）。
 * 'overview' 不是一堆笔记，而是「还没决定看哪一堆」的落点：首屏与 Esc 到底的位置。
 */
export type ViewMode = 'overview' | 'all' | 'favorites' | 'trash';

export type ThemeId =
  | 'mint-dawn'
  | 'mist-blue'
  | 'dusk-forest'
  | 'caramel-warm'
  | 'sakura-pink'
  | 'minimal-white'
  | 'liquid-glass';
export type Mode = 'light' | 'dark' | 'auto';

export interface Preferences {
  theme: ThemeId;
  mode: Mode;
  font: 'system' | 'manrope' | 'lxgw';
  density: 'comfortable' | 'standard' | 'compact';
  autoLock: number;
  language: 'zh-CN' | 'en';
}

export interface PendingConflict {
  noteId: string;
  conflicts: FieldConflict[];
  merged: MergeableNote;
  local: MergeableNote;
  server: MergeableNote;
  serverVersion: number;
}

export const DEFAULT_PREFS: Preferences = {
  theme: 'liquid-glass',
  mode: 'auto',
  font: 'system',
  density: 'standard',
  autoLock: 15,
  language: 'zh-CN',
};

export const PREFS_KEY = 'dustnote_preferences';

export function loadPrefs(): Preferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS;
}

export function savePrefs(p: Preferences): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}
