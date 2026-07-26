/**
 * 单机模式 DataRepository 实现（v2.0.0）
 *
 * 使用 AsyncStorage 持久化全部业务数据：
 * - 'dustnote_notes'：笔记密文行数组（NoteRow[]，含已软删）
 * - 'dustnote_folders'：文件夹数组（Folder[]）
 * - 'dustnote_tags'：标签数组（Tag[]）
 * - 'dustnote_preferences'：偏好设置（Preferences 对象）
 *
 * 实现说明：
 * - 任务规格要求 MMKV，但项目当前未安装 react-native-mmkv；为不引入原生依赖，
 *   本实现沿用 mobile 已有的 AsyncStorage（与 api.ts / theme.ts / state/auth.ts 一致）。
 *   后续引入 MMKV 时，只需替换 readJSON / writeJSON 两个辅助函数即可。
 *
 * 数据安全：
 * - Repository 只处理密文行（NoteRow.ciphertext 是 JSON 字符串），不感知明文
 * - 加解密在 store 层完成，单机/联机模式安全模型一致
 *
 * ID 生成：使用 shared 的 randomBytes 生成 RFC 4122 v4 UUID
 * 版本号：从 1 开始，每次 updateNote / moveNote / restoreNote 递增
 * 软删除：deleteNote 设置 deletedAt = ISO 时间；restoreNote 清空 deletedAt
 */

import type {
  DataRepository,
  RepositorySnapshot,
  CreateNoteInput,
  UpdateNoteInput,
  CreateFolderInput,
  BackupPayload,
} from '@dustnote/shared';
import type { NoteRow, Folder, Tag, Preferences } from '@dustnote/shared';
import { randomBytes } from '@dustnote/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ========== 存储键 ==========

const NOTES_KEY = 'dustnote_notes';
const FOLDERS_KEY = 'dustnote_folders';
const TAGS_KEY = 'dustnote_tags';
const PREFS_KEY = 'dustnote_preferences';

// ========== 默认值 ==========

const DEFAULT_PREFS: Preferences = {
  theme: 'mint-dawn',
  mode: 'auto',
  font: 'system',
  density: 'standard',
  autoLock: 15,
  language: 'zh-CN',
};

// ========== JSON 持久化辅助 ==========

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

// ========== ID 生成 ==========

/**
 * 生成 RFC 4122 v4 UUID
 *
 * 使用 shared 的 randomBytes（基于 @noble/hashes，跨平台可用）。
 * RN 0.74 未内置 crypto.randomUUID，故手动实现。
 */
function uuid(): string {
  const b = randomBytes(16);
  // 版本位（v4）与变体位（RFC 4122）
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 当前 ISO 时间戳 */
function nowIso(): string {
  return new Date().toISOString();
}

// ========== LocalRepository 实现 ==========

/**
 * 单机模式 Repository（AsyncStorage 后端）
 *
 * 所有方法均为 async（AsyncStorage 是异步 API）。
 * 不缓存内存数据，每次操作直接读写 AsyncStorage —— 数据量不大时性能足够；
 * 后续如需优化可引入内存缓存 + 订阅机制。
 */
export class LocalRepository implements DataRepository {
  readonly kind = 'local' as const;

  // ========== 批量加载 ==========

  async loadAll(): Promise<RepositorySnapshot> {
    const [notes, folders, tags, preferences] = await Promise.all([
      readJSON<NoteRow[]>(NOTES_KEY, []),
      readJSON<Folder[]>(FOLDERS_KEY, []),
      readJSON<Tag[]>(TAGS_KEY, []),
      readJSON<Preferences | null>(PREFS_KEY, null),
    ]);
    return { notes, folders, tags, preferences };
  }

  // ========== 笔记 CRUD ==========

  async createNote(input: CreateNoteInput): Promise<string> {
    const notes = await readJSON<NoteRow[]>(NOTES_KEY, []);
    const id = uuid();
    const ts = nowIso();
    const row: NoteRow = {
      id,
      ciphertext: input.ciphertext,
      keyVersion: input.keyVersion,
      isPinned: input.isPinned ?? false,
      isFavorite: input.isFavorite ?? false,
      deletedAt: null,
      version: 1,
      clientUpdatedAt: ts,
      serverUpdatedAt: ts,
      folderId: input.folderId ?? null,
    };
    notes.push(row);
    await writeJSON(NOTES_KEY, notes);
    return id;
  }

  async updateNote(id: string, input: UpdateNoteInput): Promise<number> {
    const notes = await readJSON<NoteRow[]>(NOTES_KEY, []);
    const idx = notes.findIndex((n) => n.id === id);
    if (idx < 0) throw new Error(`note not found: ${id}`);
    const cur = notes[idx]!;
    // version 由调用方传入时（如恢复场景）使用其值；否则递增
    const nextVersion =
      input.version !== undefined ? input.version : cur.version + 1;
    const updated: NoteRow = {
      ...cur,
      ciphertext: input.ciphertext ?? cur.ciphertext,
      keyVersion: input.keyVersion ?? cur.keyVersion,
      isPinned: input.isPinned ?? cur.isPinned,
      isFavorite: input.isFavorite ?? cur.isFavorite,
      folderId:
        input.folderId !== undefined ? input.folderId : cur.folderId,
      deletedAt:
        input.deletedAt !== undefined ? input.deletedAt : cur.deletedAt,
      version: nextVersion,
      clientUpdatedAt: nowIso(),
      serverUpdatedAt: nowIso(),
    };
    notes[idx] = updated;
    await writeJSON(NOTES_KEY, notes);
    return nextVersion;
  }

  async moveNote(id: string, folderId: string | null): Promise<void> {
    const notes = await readJSON<NoteRow[]>(NOTES_KEY, []);
    const idx = notes.findIndex((n) => n.id === id);
    if (idx < 0) throw new Error(`note not found: ${id}`);
    const cur = notes[idx]!;
    notes[idx] = {
      ...cur,
      folderId,
      version: cur.version + 1,
      clientUpdatedAt: nowIso(),
      serverUpdatedAt: nowIso(),
    };
    await writeJSON(NOTES_KEY, notes);
  }

  async deleteNote(id: string): Promise<void> {
    const notes = await readJSON<NoteRow[]>(NOTES_KEY, []);
    const idx = notes.findIndex((n) => n.id === id);
    if (idx < 0) return; // 幂等：不存在视为已删除
    const cur = notes[idx]!;
    notes[idx] = {
      ...cur,
      deletedAt: nowIso(),
      version: cur.version + 1,
      clientUpdatedAt: nowIso(),
      serverUpdatedAt: nowIso(),
    };
    await writeJSON(NOTES_KEY, notes);
  }

  async permanentDeleteNote(id: string): Promise<void> {
    const notes = await readJSON<NoteRow[]>(NOTES_KEY, []);
    const next = notes.filter((n) => n.id !== id);
    if (next.length !== notes.length) {
      await writeJSON(NOTES_KEY, next);
    }
  }

  async restoreNote(id: string): Promise<void> {
    const notes = await readJSON<NoteRow[]>(NOTES_KEY, []);
    const idx = notes.findIndex((n) => n.id === id);
    if (idx < 0) throw new Error(`note not found: ${id}`);
    const cur = notes[idx]!;
    notes[idx] = {
      ...cur,
      deletedAt: null,
      version: cur.version + 1,
      clientUpdatedAt: nowIso(),
      serverUpdatedAt: nowIso(),
    };
    await writeJSON(NOTES_KEY, notes);
  }

  async emptyTrash(): Promise<void> {
    const notes = await readJSON<NoteRow[]>(NOTES_KEY, []);
    const next = notes.filter((n) => n.deletedAt === null);
    await writeJSON(NOTES_KEY, next);
  }

  // ========== 文件夹 ==========

  async createFolder(input: CreateFolderInput): Promise<string> {
    const folders = await readJSON<Folder[]>(FOLDERS_KEY, []);
    const id = uuid();
    const ts = nowIso();
    const folder: Folder = {
      id,
      name: input.name,
      parentId: input.parentId ?? null,
      icon: input.icon ?? null,
      sortOrder: 0,
      createdAt: ts,
    };
    folders.push(folder);
    await writeJSON(FOLDERS_KEY, folders);
    return id;
  }

  async deleteFolder(id: string): Promise<void> {
    // 1. 删除文件夹
    const folders = await readJSON<Folder[]>(FOLDERS_KEY, []);
    const nextFolders = folders.filter((f) => f.id !== id);
    await writeJSON(FOLDERS_KEY, nextFolders);
    // 2. 将该文件夹下所有笔记的 folderId 置为 null
    const notes = await readJSON<NoteRow[]>(NOTES_KEY, []);
    let changed = false;
    for (let i = 0; i < notes.length; i++) {
      if (notes[i]!.folderId === id) {
        notes[i] = { ...notes[i]!, folderId: null };
        changed = true;
      }
    }
    if (changed) await writeJSON(NOTES_KEY, notes);
  }

  // ========== 标签 ==========

  async createTag(name: string, color: string | null = null): Promise<string> {
    const tags = await readJSON<Tag[]>(TAGS_KEY, []);
    const id = uuid();
    const tag: Tag = { id, name, color, count: 0 };
    tags.push(tag);
    await writeJSON(TAGS_KEY, tags);
    return id;
  }

  async deleteTag(id: string): Promise<void> {
    const tags = await readJSON<Tag[]>(TAGS_KEY, []);
    const next = tags.filter((t) => t.id !== id);
    await writeJSON(TAGS_KEY, next);
  }

  // ========== 偏好设置 ==========

  async getPreferences(): Promise<Preferences | null> {
    return readJSON<Preferences | null>(PREFS_KEY, null);
  }

  async setPreferences(partial: Partial<Preferences>): Promise<void> {
    const cur = await readJSON<Preferences | null>(PREFS_KEY, null);
    const next: Preferences = { ...(cur ?? DEFAULT_PREFS), ...partial };
    await writeJSON(PREFS_KEY, next);
  }

  // ========== 备份与迁移 ==========

  async exportBackup(): Promise<BackupPayload> {
    const { notes, folders, tags, preferences } = await this.loadAll();
    return {
      version: '2.0.0',
      exportedAt: nowIso(),
      notes,
      folders,
      tags,
      preferences,
      source: 'standalone',
    };
  }

  async importBackup(payload: BackupPayload): Promise<void> {
    // 全量覆盖式导入：用于模式迁移或用户恢复
    await writeJSON(NOTES_KEY, payload.notes ?? []);
    await writeJSON(FOLDERS_KEY, payload.folders ?? []);
    await writeJSON(TAGS_KEY, payload.tags ?? []);
    await writeJSON(PREFS_KEY, payload.preferences ?? null);
  }

  // ========== 清理 ==========

  async clearBusinessData(): Promise<void> {
    // 清空全部业务数据（保留鉴权信息 / 模式状态）
    await Promise.all([
      AsyncStorage.removeItem(NOTES_KEY),
      AsyncStorage.removeItem(FOLDERS_KEY),
      AsyncStorage.removeItem(TAGS_KEY),
      AsyncStorage.removeItem(PREFS_KEY),
    ]);
  }
}
