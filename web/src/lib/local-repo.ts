/**
 * Web 端单机模式 DataRepository 实现（IndexedDB）
 *
 * 使用 idb-keyval 持久化数据：
 * - 'dustnote:local:notes'：NoteRow 数组（含已软删的）
 * - 'dustnote:local:folders'：Folder 数组
 * - 'dustnote:local:tags'：Tag 数组
 * - 'dustnote:local:preferences'：Preferences 对象
 *
 * 注意：此 Repository 处理的是密文行（ciphertext 是 JSON 字符串），
 * 加解密在 store 层完成。
 */

import { get, set, del } from 'idb-keyval';
import type {
  DataRepository,
  RepositorySnapshot,
  CreateNoteInput,
  UpdateNoteInput,
  CreateFolderInput,
  BackupPayload,
  NoteRow,
  Folder,
  Tag,
  Preferences,
} from '@dustnote/shared';

const KEYS = {
  notes: 'dustnote:local:notes',
  folders: 'dustnote:local:folders',
  tags: 'dustnote:local:tags',
  preferences: 'dustnote:local:preferences',
} as const;

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class LocalRepository implements DataRepository {
  readonly kind = 'local' as const;

  // ========== 批量加载 ==========

  async loadAll(): Promise<RepositorySnapshot> {
    const [notes, folders, tags, preferences] = await Promise.all([
      get<NoteRow[]>(KEYS.notes),
      get<Folder[]>(KEYS.folders),
      get<Tag[]>(KEYS.tags),
      get<Preferences>(KEYS.preferences),
    ]);
    return {
      notes: notes ?? [],
      folders: folders ?? [],
      tags: tags ?? [],
      preferences: preferences ?? null,
    };
  }

  // ========== 笔记 CRUD ==========

  async createNote(input: CreateNoteInput): Promise<string> {
    const notes = (await get<NoteRow[]>(KEYS.notes)) ?? [];
    // 客户端可能预生成 id（作为密文 AAD 绑定，§2.2），缺省由仓库生成
    const id = input.id ?? generateId();
    const now = new Date().toISOString();
    const note: NoteRow = {
      id,
      ciphertext: input.ciphertext,
      keyVersion: input.keyVersion,
      isPinned: input.isPinned ?? false,
      isFavorite: input.isFavorite ?? false,
      deletedAt: null,
      version: 1,
      clientUpdatedAt: now,
      serverUpdatedAt: now,
      folderId: input.folderId ?? null,
    };
    notes.push(note);
    await set(KEYS.notes, notes);
    return id;
  }

  async updateNote(id: string, input: UpdateNoteInput): Promise<number> {
    const notes = (await get<NoteRow[]>(KEYS.notes)) ?? [];
    const idx = notes.findIndex((n) => n.id === id);
    if (idx === -1) throw new Error(`Note not found: ${id}`);
    const note = notes[idx]!;
    const updated: NoteRow = {
      ...note,
      ...(input.ciphertext !== undefined && { ciphertext: input.ciphertext }),
      ...(input.keyVersion !== undefined && { keyVersion: input.keyVersion }),
      ...(input.isPinned !== undefined && { isPinned: input.isPinned }),
      ...(input.isFavorite !== undefined && { isFavorite: input.isFavorite }),
      ...(input.folderId !== undefined && { folderId: input.folderId }),
      ...(input.deletedAt !== undefined && { deletedAt: input.deletedAt }),
      version: note.version + 1,
      clientUpdatedAt: new Date().toISOString(),
      serverUpdatedAt: new Date().toISOString(),
    };
    notes[idx] = updated;
    await set(KEYS.notes, notes);
    return updated.version;
  }

  async moveNote(id: string, folderId: string | null): Promise<void> {
    await this.updateNote(id, { folderId });
  }

  async deleteNote(id: string): Promise<void> {
    await this.updateNote(id, { deletedAt: new Date().toISOString() });
  }

  async permanentDeleteNote(id: string): Promise<void> {
    const notes = (await get<NoteRow[]>(KEYS.notes)) ?? [];
    const filtered = notes.filter((n) => n.id !== id);
    await set(KEYS.notes, filtered);
  }

  async restoreNote(id: string): Promise<void> {
    await this.updateNote(id, { deletedAt: null });
  }

  async emptyTrash(): Promise<void> {
    const notes = (await get<NoteRow[]>(KEYS.notes)) ?? [];
    const kept = notes.filter((n) => !n.deletedAt);
    await set(KEYS.notes, kept);
  }

  // ========== 文件夹 ==========

  async createFolder(input: CreateFolderInput): Promise<string> {
    const folders = (await get<Folder[]>(KEYS.folders)) ?? [];
    const id = generateId();
    const folder: Folder = {
      id,
      name: input.name,
      parentId: input.parentId ?? null,
      icon: input.icon ?? null,
      sortOrder: folders.length,
      createdAt: new Date().toISOString(),
    };
    folders.push(folder);
    await set(KEYS.folders, folders);
    return id;
  }

  async deleteFolder(id: string): Promise<void> {
    const folders = (await get<Folder[]>(KEYS.folders)) ?? [];
    const filtered = folders.filter((f) => f.id !== id);
    await set(KEYS.folders, filtered);
    // 将该文件夹下的笔记 folderId 置为 null
    const notes = (await get<NoteRow[]>(KEYS.notes)) ?? [];
    let changed = false;
    for (const n of notes) {
      if (n.folderId === id) {
        n.folderId = null;
        changed = true;
      }
    }
    if (changed) await set(KEYS.notes, notes);
  }

  // ========== 标签 ==========

  async createTag(name: string, color: string | null = null): Promise<string> {
    const tags = (await get<Tag[]>(KEYS.tags)) ?? [];
    const id = generateId();
    tags.push({ id, name, color, count: 0 });
    await set(KEYS.tags, tags);
    return id;
  }

  async deleteTag(id: string): Promise<void> {
    const tags = (await get<Tag[]>(KEYS.tags)) ?? [];
    const filtered = tags.filter((t) => t.id !== id);
    await set(KEYS.tags, filtered);
  }

  // ========== 偏好设置 ==========

  async getPreferences(): Promise<Preferences | null> {
    return (await get<Preferences>(KEYS.preferences)) ?? null;
  }

  async setPreferences(partial: Partial<Preferences>): Promise<void> {
    const current = (await get<Preferences>(KEYS.preferences)) ?? null;
    const next = current ? { ...current, ...partial } : partial;
    await set(KEYS.preferences, next);
  }

  // ========== 备份与迁移 ==========

  async exportBackup(): Promise<BackupPayload> {
    const snapshot = await this.loadAll();
    return {
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      notes: snapshot.notes,
      folders: snapshot.folders,
      tags: snapshot.tags,
      preferences: snapshot.preferences,
      source: 'standalone',
    };
  }

  async importBackup(payload: BackupPayload): Promise<void> {
    await set(KEYS.notes, payload.notes);
    await set(KEYS.folders, payload.folders);
    await set(KEYS.tags, payload.tags);
    if (payload.preferences) {
      await set(KEYS.preferences, payload.preferences);
    }
  }

  async clearBusinessData(): Promise<void> {
    await Promise.all([
      del(KEYS.notes),
      del(KEYS.folders),
      del(KEYS.tags),
      del(KEYS.preferences),
    ]);
  }
}
