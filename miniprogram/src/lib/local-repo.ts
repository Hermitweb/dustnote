/**
 * 小程序单机模式 DataRepository 实现（Taro.setStorage）
 *
 * 使用 Taro.setStorage / Taro.getStorage 持久化数据：
 * - 'dustnote_notes'：NoteRow 数组（含已软删的）
 * - 'dustnote_folders'：Folder 数组
 * - 'dustnote_tags'：Tag 数组
 * - 'dustnote_preferences'：Preferences 对象
 *
 * 注意：
 * - 此 Repository 处理的是密文行（ciphertext 是 JSON 字符串），加解密在 store 层完成
 * - Taro.setStorage/Taro.getStorage 是异步的，所有方法均使用 async/await
 * - 单条数据大小限制：微信小程序单 key 上限 1MB，全量数据上限 10MB
 *   （超过需分片存储，这里按单 key 简化处理，对笔记数量较少的场景足够）
 * - crypto.randomUUID 在 weapp 不一定可用，使用 Date + Math.random 兜底生成 ID
 */

import Taro from '@tarojs/taro';
import { APP_VERSION } from '../state/auth';
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
  notes: 'dustnote_notes',
  folders: 'dustnote_folders',
  tags: 'dustnote_tags',
  preferences: 'dustnote_preferences',
} as const;

/**
 * 生成唯一 ID
 *
 * weapp 运行时 crypto.randomUUID 可能不可用（部分基础库版本），
 * 使用 Date.now + Math.random 兜底，确保跨平台兼容。
 */
function generateId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* crypto API 异常，走兜底 */
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * 异步读取 storage 中的数据，并断言类型
 *
 * Taro.getStorage 在 key 不存在时会 reject，这里捕获异常返回 undefined。
 */
async function readKey<T>(key: string): Promise<T | undefined> {
  try {
    const res = await Taro.getStorage({ key });
    return res.data as T;
  } catch {
    return undefined;
  }
}

/** 异步写入 storage */
async function writeKey<T>(key: string, data: T): Promise<void> {
  await Taro.setStorage({ key, data });
}

/** 异步删除 storage key */
async function removeKey(key: string): Promise<void> {
  try {
    await Taro.removeStorage({ key });
  } catch {
    /* key 不存在时 removeStorage 会 reject，忽略 */
  }
}

export class LocalRepository implements DataRepository {
  readonly kind = 'local' as const;

  // ========== 批量加载 ==========

  async loadAll(): Promise<RepositorySnapshot> {
    const [notes, folders, tags, preferences] = await Promise.all([
      readKey<NoteRow[]>(KEYS.notes),
      readKey<Folder[]>(KEYS.folders),
      readKey<Tag[]>(KEYS.tags),
      readKey<Preferences>(KEYS.preferences),
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
    const notes = (await readKey<NoteRow[]>(KEYS.notes)) ?? [];
    // 优先客户端预生成 id(AAD 绑定 noteId||userId)
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
    await writeKey(KEYS.notes, notes);
    return id;
  }

  async updateNote(id: string, input: UpdateNoteInput): Promise<number> {
    const notes = (await readKey<NoteRow[]>(KEYS.notes)) ?? [];
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
    await writeKey(KEYS.notes, notes);
    return updated.version;
  }

  async moveNote(id: string, folderId: string | null): Promise<void> {
    await this.updateNote(id, { folderId });
  }

  async deleteNote(id: string): Promise<void> {
    await this.updateNote(id, { deletedAt: new Date().toISOString() });
  }

  async permanentDeleteNote(id: string): Promise<void> {
    const notes = (await readKey<NoteRow[]>(KEYS.notes)) ?? [];
    const filtered = notes.filter((n) => n.id !== id);
    await writeKey(KEYS.notes, filtered);
  }

  async restoreNote(id: string): Promise<void> {
    await this.updateNote(id, { deletedAt: null });
  }

  async emptyTrash(): Promise<void> {
    const notes = (await readKey<NoteRow[]>(KEYS.notes)) ?? [];
    const kept = notes.filter((n) => !n.deletedAt);
    await writeKey(KEYS.notes, kept);
  }

  // ========== 文件夹 ==========

  async createFolder(input: CreateFolderInput): Promise<string> {
    const folders = (await readKey<Folder[]>(KEYS.folders)) ?? [];
    const id = generateId();
    const folder: Folder = {
      id,
      name: input.name,
      parentId: input.parentId ?? null,
      icon: input.icon ?? null,
      sortOrder: folders.length,
      createdAt: new Date().toISOString(),
      depth: input.parentId ? (folders.find((f) => f.id === input.parentId)?.depth ?? 1) + 1 : 1,
      branch: input.parentId
        ? (folders.find((f) => f.id === input.parentId)?.branch ?? null)
        : (input.branch ?? null),
    };
    folders.push(folder);
    await writeKey(KEYS.folders, folders);
    return id;
  }

  async renameFolder(id: string, name: string): Promise<void> {
    const folders = (await readKey<Folder[]>(KEYS.folders)) ?? [];
    const next = folders.map((f) => (f.id === id ? { ...f, name } : f));
    await writeKey(KEYS.folders, next);
  }

  async moveFolder(id: string, parentId: string | null): Promise<void> {
    const folders = (await readKey<Folder[]>(KEYS.folders)) ?? [];
    const parent = parentId ? folders.find((f) => f.id === parentId) : undefined;
    const depth = parent ? (parent.depth ?? 1) + 1 : 1;
    const branch = parent ? (parent.branch ?? null) : null;
    const next = folders.map((f) => (f.id === id ? { ...f, parentId, depth, branch } : f));
    await writeKey(KEYS.folders, next);
  }

  async deleteFolder(id: string): Promise<void> {
    const folders = (await readKey<Folder[]>(KEYS.folders)) ?? [];
    const filtered = folders.filter((f) => f.id !== id);
    await writeKey(KEYS.folders, filtered);
    // 将该文件夹下的笔记 folderId 置为 null
    const notes = (await readKey<NoteRow[]>(KEYS.notes)) ?? [];
    let changed = false;
    for (const n of notes) {
      if (n.folderId === id) {
        n.folderId = null;
        changed = true;
      }
    }
    if (changed) await writeKey(KEYS.notes, notes);
  }

  // ========== 标签 ==========

  async createTag(name: string, color: string | null = null): Promise<string> {
    const tags = (await readKey<Tag[]>(KEYS.tags)) ?? [];
    const id = generateId();
    tags.push({ id, name, color, count: 0 });
    await writeKey(KEYS.tags, tags);
    return id;
  }

  async deleteTag(id: string): Promise<void> {
    const tags = (await readKey<Tag[]>(KEYS.tags)) ?? [];
    const filtered = tags.filter((t) => t.id !== id);
    await writeKey(KEYS.tags, filtered);
  }

  // ========== 偏好设置 ==========

  async getPreferences(): Promise<Preferences | null> {
    return (await readKey<Preferences>(KEYS.preferences)) ?? null;
  }

  async setPreferences(partial: Partial<Preferences>): Promise<void> {
    const current = (await readKey<Preferences>(KEYS.preferences)) ?? null;
    const next = current ? { ...current, ...partial } : partial;
    await writeKey(KEYS.preferences, next);
  }

  // ========== 备份与迁移 ==========

  async exportBackup(): Promise<BackupPayload> {
    const snapshot = await this.loadAll();
    return {
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      notes: snapshot.notes,
      folders: snapshot.folders,
      tags: snapshot.tags,
      preferences: snapshot.preferences,
      source: 'standalone',
    };
  }

  async importBackup(payload: BackupPayload): Promise<void> {
    await writeKey(KEYS.notes, payload.notes);
    await writeKey(KEYS.folders, payload.folders);
    await writeKey(KEYS.tags, payload.tags);
    if (payload.preferences) {
      await writeKey(KEYS.preferences, payload.preferences);
    }
  }

  async clearBusinessData(): Promise<void> {
    await Promise.all([
      removeKey(KEYS.notes),
      removeKey(KEYS.folders),
      removeKey(KEYS.tags),
      removeKey(KEYS.preferences),
    ]);
  }
}
