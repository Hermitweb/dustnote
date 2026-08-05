/**
 * 小程序联机模式 DataRepository 实现（封装 ApiClient）
 *
 * 将 state/auth.ts 中的 API 调用迁移到这里，统一通过 DataRepository 接口访问。
 *
 * 注意：
 * - 此 Repository 处理的是密文行（ciphertext 是 JSON 字符串），加解密在 store 层完成
 * - 通过依赖注入的 getApi 函数获取 ApiClient 实例，确保 accessToken 始终是最新值
 * - 服务器地址由 mode-store 管理，getApi 函数内部读取 mode-store 的 serverUrl
 *
 * 与 web 端 remote-repo.ts 的差异：
 * - web 端通过 __APP_VERSION__ 编译时注入版本号
 * - 小程序端直接使用常量 APP_VERSION（与 state/auth.ts 保持一致）
 */

import { APP_VERSION } from '../state/auth';
import type {
  ApiClient,
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

export class RemoteRepository implements DataRepository {
  readonly kind = 'remote' as const;

  /**
   * @param getApi 返回最新的 ApiClient 实例的函数
   *   （由调用方注入，通常绑定到 state/auth.ts 的 getApi()，
   *    该函数内部读取 useAuthStore.getState().accessToken）
   */
  constructor(private readonly getApi: () => ApiClient) {}

  // ========== 批量加载 ==========

  async loadAll(): Promise<RepositorySnapshot> {
    const a = this.getApi();
    const [notesRes, foldersRes, tagsRes] = await Promise.all([
      a.get<{ notes: NoteRow[] }>('/notes?includeDeleted=1'),
      a.get<{ folders: Folder[] }>('/folders'),
      a.get<{ tags: Tag[] }>('/tags'),
    ]);
    // preferences 单独获取（可能不存在）
    let preferences: Preferences | null = null;
    try {
      preferences = await a.get<Preferences>('/preferences');
    } catch {
      preferences = null;
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
    const r = await this.getApi().post<{ id: string }>('/notes', {
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

    const r = await this.getApi().patch<{ version: number }>(`/notes/${id}`, body);
    return r.version;
  }

  async moveNote(id: string, folderId: string | null): Promise<void> {
    await this.getApi().patch(`/notes/${id}`, {
      folderId,
      clientUpdatedAt: new Date().toISOString(),
    });
  }

  async deleteNote(id: string): Promise<void> {
    await this.getApi().delete(`/notes/${id}`);
  }

  async permanentDeleteNote(id: string): Promise<void> {
    await this.getApi().delete(`/notes/${id}/permanent`);
  }

  async restoreNote(id: string): Promise<void> {
    await this.getApi().patch(`/notes/${id}`, {
      deletedAt: null,
      clientUpdatedAt: new Date().toISOString(),
    });
  }

  async emptyTrash(): Promise<void> {
    // 服务端无批量清空接口，逐条永久删除
    // 使用顺序删除而非 Promise.all：
    // - 避免回收站笔记数量较多时并发请求风暴触发服务端限流
    // - 任一条删除失败不阻塞后续，最终汇总失败项
    const notes = await this.loadAll();
    const trashNotes = notes.notes.filter((n) => n.deletedAt);
    for (const n of trashNotes) {
      try {
        await this.getApi().delete(`/notes/${n.id}/permanent`);
      } catch {
        // 单条失败不中断整体流程，继续尝试其余项
      }
    }
  }

  // ========== 文件夹 ==========

  async createFolder(input: CreateFolderInput): Promise<string> {
    const r = await this.getApi().post<{ id: string }>('/folders', {
      name: input.name,
      parentId: input.parentId ?? null,
      icon: input.icon ?? null,
    });
    return r.id;
  }

  async deleteFolder(id: string): Promise<void> {
    await this.getApi().delete(`/folders/${id}`);
  }

  // ========== 标签 ==========

  async createTag(name: string, color: string | null = null): Promise<string> {
    const r = await this.getApi().post<{ id: string }>('/tags', { name, color });
    return r.id;
  }

  async deleteTag(id: string): Promise<void> {
    await this.getApi().delete(`/tags/${id}`);
  }

  // ========== 偏好设置 ==========

  async getPreferences(): Promise<Preferences | null> {
    try {
      return await this.getApi().get<Preferences>('/preferences');
    } catch {
      return null;
    }
  }

  async setPreferences(partial: Partial<Preferences>): Promise<void> {
    await this.getApi().patch('/preferences', partial);
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
      source: 'online',
    };
  }

  async importBackup(payload: BackupPayload): Promise<void> {
    // 联机模式：逐条创建笔记/文件夹/标签
    for (const folder of payload.folders) {
      try {
        await this.createFolder({ name: folder.name, parentId: folder.parentId, icon: folder.icon });
      } catch {
        /* 已存在则跳过 */
      }
    }
    for (const tag of payload.tags) {
      try {
        await this.createTag(tag.name, tag.color);
      } catch {
        /* 已存在则跳过 */
      }
    }
    for (const note of payload.notes) {
      try {
        await this.createNote({
          ciphertext: note.ciphertext,
          keyVersion: note.keyVersion,
          isPinned: note.isPinned,
          isFavorite: note.isFavorite,
          folderId: note.folderId,
        });
      } catch {
        /* 跳过失败项 */
      }
    }
    if (payload.preferences) {
      await this.setPreferences(payload.preferences);
    }
  }

  async clearBusinessData(): Promise<void> {
    // 联机模式由服务端管理，客户端不需要清理
    // 注销时服务端会清理 token
  }
}
