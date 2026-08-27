/**
 * Store 类型定义（从 store.ts 提取）
 *
 * 所有共享类型集中在此，避免循环依赖。
 */

import type {
  NoteCipherEnvelope,
  MergeableNote,
  FieldConflict,
} from '@dustnote/client-core';

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
export type ViewMode = 'all' | 'favorites' | 'trash';

export type ThemeId =
  | 'mint-dawn'
  | 'mist-blue'
  | 'dusk-forest'
  | 'caramel-warm'
  | 'sakura-pink'
  | 'minimal-white';
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
  theme: 'mint-dawn',
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
