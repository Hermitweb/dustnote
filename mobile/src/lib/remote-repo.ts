/**
 * 联机模式 DataRepository 实现（v2.0.0）
 *
 * 封装 mobile/src/api.ts 的 ApiClient（api 单例）。
 * baseUrl 由 api.ts 内部从 mode-store 动态解析，故本实现直接复用 api 单例。
 *
 * 接口契约对齐 shared/src/repository.ts 的 DataRepository。
 * 服务端路径与 mobile/src/screens/ 现有调用保持一致：
 * - loadAll: GET /notes?includeDeleted=1 + GET /folders + GET /tags + GET /auth/me
 * - createNote: POST /notes
 * - updateNote: PATCH /notes/:id
 * - moveNote: PATCH /notes/:id (body: { folderId, version })
 * - deleteNote: DELETE /notes/:id
 * - permanentDeleteNote: DELETE /notes/:id/permanent
 * - restoreNote: PATCH /notes/:id (body: { deletedAt: null, version })
 * - emptyTrash: 对每个已软删笔记调用 DELETE /notes/:id/permanent
 * - createFolder: POST /folders
 * - deleteFolder: DELETE /folders/:id
 * - createTag: POST /tags
 * - deleteTag: DELETE /tags/:id
 * - getPreferences: GET /preferences
 * - setPreferences: PATCH /preferences
 * - exportBackup: 组合 loadAll 数据
 * - importBackup: 批量创建（POST /notes 逐条）
 * - clearBusinessData: 联机模式由服务端管理，no-op
 */

import type {
  DataRepository,
  RepositorySnapshot,
  CreateNoteInput,
  UpdateNoteInput,
  CreateFolderInput,
  BackupPayload,
} from '@dustnote/shared';
import type { NoteRow, Folder, Tag, Preferences, Ciphertext } from '@dustnote/shared';
import { api } from '../api';

// ========== 服务端响应类型 ==========

interface NotesResponse {
  notes: NoteRow[];
}

interface FoldersResponse {
  folders: Folder[];
}

interface TagsResponse {
  tags: Tag[];
}

interface AuthMeResponse {
  wrappedMasterKey: Ciphertext;
}

interface CreateNoteResponse {
  id: string;
  serverUpdatedAt: string;
  version: number;
}

interface UpdateNoteResponse {
  version: number;
  serverUpdatedAt?: string;
}

interface CreateFolderResponse {
  id: string;
}

interface CreateTagResponse {
  id: string;
}

// ========== RemoteRepository 实现 ==========

/**
 * 联机模式 Repository（封装 api 单例）
 *
 * 不持有状态，每次调用都发起网络请求。
 * 不做离线队列（由 store 层 / 后续批次处理）。
 */
export class RemoteRepository implements DataRepository {
  readonly kind = 'remote' as const;

  // ========== 批量加载 ==========

  async loadAll(): Promise<RepositorySnapshot> {
    const [notesRes, foldersRes, tagsRes, meRes] = await Promise.all([
      api.get<NotesResponse>('/notes?includeDeleted=1'),
      api.get<FoldersResponse>('/folders'),
      api.get<TagsResponse>('/tags'),
      api.get<AuthMeResponse>('/auth/me'),
    ]);
    // wrappedMasterKey 由 auth-store 使用，这里仅返回笔记 / 文件夹 / 标签 / 偏好
    // 偏好单独请求（loadAll 不强制要求；为减少请求次数，留给 store 自行调用 getPreferences）
    void meRes; // 暂不在此暴露 wrappedMasterKey，由 auth-store 单独请求
    let preferences: Preferences | null = null;
    try {
      preferences = await this.getPreferences();
    } catch {
      /* 偏好获取失败不阻塞 loadAll */
    }
    return {
      notes: notesRes.notes,
      folders: foldersRes.folders,
      tags: tagsRes.tags,
      preferences,
    };
  }

  // ========== 笔记 CRUD ==========

  async createNote(input: CreateNoteInput): Promise<string> {
    const r = await api.post<CreateNoteResponse>('/notes', {
      ciphertext: input.ciphertext,
      keyVersion: input.keyVersion,
      isPinned: input.isPinned ?? false,
      isFavorite: input.isFavorite ?? false,
      clientUpdatedAt: new Date().toISOString(),
      folderId: input.folderId ?? null,
    });
    return r.id;
  }

  async updateNote(id: string, input: UpdateNoteInput): Promise<number> {
    const body: Record<string, unknown> = {
      clientUpdatedAt: new Date().toISOString(),
    };
    if (input.ciphertext !== undefined) body.ciphertext = input.ciphertext;
    if (input.keyVersion !== undefined) body.keyVersion = input.keyVersion;
    if (input.isPinned !== undefined) body.isPinned = input.isPinned;
    if (input.isFavorite !== undefined) body.isFavorite = input.isFavorite;
    if (input.folderId !== undefined) body.folderId = input.folderId;
    if (input.deletedAt !== undefined) body.deletedAt = input.deletedAt;
    if (input.version !== undefined) body.version = input.version;
    const r = await api.patch<UpdateNoteResponse>(`/notes/${id}`, body);
    return r.version;
  }

  async moveNote(id: string, folderId: string | null): Promise<void> {
    await api.patch<UpdateNoteResponse>(`/notes/${id}`, {
      folderId,
      clientUpdatedAt: new Date().toISOString(),
    });
  }

  async deleteNote(id: string): Promise<void> {
    await api.delete(`/notes/${id}`);
  }

  async permanentDeleteNote(id: string): Promise<void> {
    await api.delete(`/notes/${id}/permanent`);
  }

  async restoreNote(id: string): Promise<void> {
    await api.patch<UpdateNoteResponse>(`/notes/${id}`, {
      deletedAt: null,
      clientUpdatedAt: new Date().toISOString(),
    });
  }

  async emptyTrash(): Promise<void> {
    // 服务端无批量清空接口，逐条永久删除
    // 硬约束：使用顺序删除（for...of）而非 Promise.all，避免请求风暴
    const r = await api.get<NotesResponse>('/notes?includeDeleted=1');
    const trashIds = r.notes.filter((n) => n.deletedAt !== null).map((n) => n.id);
    if (trashIds.length === 0) return;
    for (const tid of trashIds) {
      await api.delete(`/notes/${tid}/permanent`);
    }
  }

  // ========== 文件夹 ==========

  async createFolder(input: CreateFolderInput): Promise<string> {
    const r = await api.post<CreateFolderResponse>('/folders', {
      name: input.name,
      parentId: input.parentId ?? null,
      icon: input.icon ?? null,
    });
    return r.id;
  }

  async deleteFolder(id: string): Promise<void> {
    await api.delete(`/folders/${id}`);
  }

  // ========== 标签 ==========

  async createTag(name: string, color: string | null = null): Promise<string> {
    const r = await api.post<CreateTagResponse>('/tags', { name, color });
    return r.id;
  }

  async deleteTag(id: string): Promise<void> {
    await api.delete(`/tags/${id}`);
  }

  // ========== 偏好设置 ==========

  async getPreferences(): Promise<Preferences | null> {
    return api.get<Preferences>('/preferences');
  }

  async setPreferences(partial: Partial<Preferences>): Promise<void> {
    await api.patch('/preferences', partial);
  }

  // ========== 备份与迁移 ==========

  async exportBackup(): Promise<BackupPayload> {
    const { notes, folders, tags, preferences } = await this.loadAll();
    return {
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      notes,
      folders,
      tags,
      preferences,
      source: 'online',
    };
  }

  async importBackup(payload: BackupPayload): Promise<void> {
    // 服务端无批量导入接口，逐条创建笔记；文件夹 / 标签 / 偏好同步设置
    // 注意：此操作不是原子的，部分失败时已创建的数据保留
    for (const note of payload.notes ?? []) {
      // 已软删的笔记跳过（避免恢复回收站垃圾）
      if (note.deletedAt) continue;
      await api.post<CreateNoteResponse>('/notes', {
        ciphertext: note.ciphertext,
        keyVersion: note.keyVersion,
        isPinned: note.isPinned,
        isFavorite: note.isFavorite,
        folderId: note.folderId,
        clientUpdatedAt: note.clientUpdatedAt,
      });
    }
    for (const folder of payload.folders ?? []) {
      await api.post<CreateFolderResponse>('/folders', {
        name: folder.name,
        parentId: folder.parentId,
        icon: folder.icon,
      });
    }
    for (const tag of payload.tags ?? []) {
      await api.post<CreateTagResponse>('/tags', {
        name: tag.name,
        color: tag.color,
      });
    }
    if (payload.preferences) {
      await this.setPreferences(payload.preferences);
    }
  }

  // ========== 清理 ==========

  async clearBusinessData(): Promise<void> {
    // 联机模式业务数据由服务端管理，客户端无需（也不应）直接清理。
    // 注销流程由 auth-store 调用 /auth/logout 完成。
    // 此处保留为 no-op 以满足接口契约。
  }
}
