/**
 * 联机模式 DataRepository 实现（跨端单一实现，审计 ARCH-002）
 *
 * 此前 web / mobile / miniprogram 各写一份 RemoteRepository，已漂移出多处分歧
 * （mobile 的 emptyTrash 未分页会在 >500 条回收站时静默漏删；web 的 version
 * 兜底发 0 而非省略；createFolder 的 null 处理三端不一致）。现收敛为单一实现，
 * 平台差异只保留在「如何构造 ApiClient」这一处注入点。
 *
 * 设计要点：
 * - 只依赖 shared 的 ApiClient 抽象，不感知平台（无 __APP_VERSION__ / Taro / RN）
 * - 构造函数注入 `() => ApiClient`，每次调用时取最新实例（token 轮换后仍有效）
 * - 处理的是密文行（ciphertext 为 JSON 字符串），加解密在调用方 store 层完成
 * - 不实现离线队列：由 store 层的 runOrEnqueue 等编排处理
 */
import type { ApiClient } from '@dustnote/shared';
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

/** 服务端列表响应（游标分页） */
interface NotesPage {
  notes: NoteRow[];
  hasMore?: boolean;
  nextCursor?: string | null;
}

/** 分页防御性上限：500 条/页 × 200 页，防服务端异常导致死循环 */
const MAX_PAGES = 200;

export interface RemoteRepositoryOptions {
  /**
   * 备份载荷里写入的版本号（信息字段，导入方不校验）。
   * web 传编译期注入的 __APP_VERSION__，小程序/安卓传各自常量。
   */
  appVersion?: string;
}

export class RemoteRepository implements DataRepository {
  readonly kind = 'remote' as const;

  /** 最近一次 loadAll 快照中各笔记的 version——PATCH 乐观锁必带
   *  （服务端 UpdateNoteSchema.version 必填，缺失一律 400，
   *   曾致小程序自动保存/置顶/收藏/移动全不可用） */
  private lastVersions = new Map<string, number>();

  /**
   * @param getApi 返回最新 ApiClient 实例的函数（调用方注入，内部读取最新 accessToken
   *   与 serverUrl；web 每次新建、mobile/miniprogram 复用单例）
   */
  constructor(
    private readonly getApi: () => ApiClient,
    private readonly options: RemoteRepositoryOptions = {}
  ) {}

  // ========== 批量加载 ==========

  async loadAll(): Promise<RepositorySnapshot> {
    const a = this.getApi();
    // 游标分页循环（H-B/H3）：服务端单页上限 500，必须拉到 hasMore=false 才算
    // 全量——单发一次时 >500 条笔记的最旧部分会从列表/导出中静默消失
    const [firstPage, foldersRes, tagsRes] = await Promise.all([
      a.get<NotesPage>('/notes?includeDeleted=1'),
      a.get<{ folders: Folder[] }>('/folders'),
      a.get<{ tags: Tag[] }>('/tags'),
    ]);
    let allNotes = firstPage.notes;
    let cursor: string | null = firstPage.nextCursor ?? null;
    for (let page = 0; page < MAX_PAGES && cursor; page++) {
      const next = await a.get<NotesPage>(
        `/notes?includeDeleted=1&cursor=${encodeURIComponent(cursor)}`
      );
      allNotes = allNotes.concat(next.notes);
      cursor = next.nextCursor ?? null;
    }
    this.lastVersions = new Map(allNotes.map((n) => [n.id, n.version]));
    // preferences 单独获取（可能不存在；失败不阻塞 loadAll）
    let preferences: Preferences | null = null;
    try {
      preferences = await a.get<Preferences>('/preferences');
    } catch {
      preferences = null;
    }
    return {
      notes: allNotes,
      folders: foldersRes.folders,
      tags: tagsRes.tags,
      preferences,
    };
  }

  // ========== 笔记 CRUD ==========

  async createNote(input: CreateNoteInput): Promise<string> {
    const r = await this.getApi().post<{ id: string }>('/notes', {
      // 客户端预生成 id：密文 AAD 绑定 noteId||userId，必须在加密前确定；
      // 服务端 ON CONFLICT 幂等，迁移重试不会产生重复笔记
      ...(input.id ? { id: input.id } : {}),
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
    // 乐观锁 version 必带：优先调用方显式传入，否则用最近快照记录值；
    // 都取不到时不发 version（服务端 400 明确报错），并发 0 会伪装成「版本冲突」
    const version = input.version ?? this.lastVersions.get(id);
    if (version !== undefined) body.version = version;

    const r = await this.getApi().patch<{ version: number }>(`/notes/${id}`, body);
    this.lastVersions.set(id, r.version);
    return r.version;
  }

  async moveNote(id: string, folderId: string | null): Promise<void> {
    const body: Record<string, unknown> = {
      folderId,
      clientUpdatedAt: new Date().toISOString(),
    };
    const version = this.lastVersions.get(id);
    if (version !== undefined) body.version = version;
    const r = await this.getApi().patch<{ version: number }>(`/notes/${id}`, body);
    if (typeof r?.version === 'number') this.lastVersions.set(id, r.version);
  }

  async deleteNote(id: string): Promise<void> {
    await this.getApi().delete(`/notes/${id}`);
  }

  async permanentDeleteNote(id: string): Promise<void> {
    await this.getApi().delete(`/notes/${id}/permanent`);
  }

  async restoreNote(id: string): Promise<void> {
    const body: Record<string, unknown> = {
      deletedAt: null,
      clientUpdatedAt: new Date().toISOString(),
    };
    const version = this.lastVersions.get(id);
    if (version !== undefined) body.version = version;
    const r = await this.getApi().patch<{ version: number }>(`/notes/${id}`, body);
    if (typeof r?.version === 'number') this.lastVersions.set(id, r.version);
  }

  async emptyTrash(): Promise<{ deleted: number; failed: number }> {
    // 服务端无批量清空接口，逐条永久删除
    // 顺序删除而非 Promise.all：避免请求风暴触发限流；任一条失败不阻塞后续
    // 用 loadAll()（游标分页）取回收站——单发一页会在 >500 条时静默漏删
    const snapshot = await this.loadAll();
    const trashNotes = snapshot.notes.filter((n) => n.deletedAt);
    let deleted = 0;
    let failed = 0;
    for (const n of trashNotes) {
      try {
        await this.getApi().delete(`/notes/${n.id}/permanent`);
        deleted += 1;
      } catch {
        failed += 1;
      }
    }
    return { deleted, failed };
  }

  // ========== 文件夹 ==========

  async createFolder(input: CreateFolderInput): Promise<string> {
    // 服务端 FolderSchema 的 icon/branch 为 nullish（显式 null 合法），
    // parentId 亦接受 null；顶层文件夹 branch 传 null 由服务端按契约处理
    const r = await this.getApi().post<{ id: string }>('/folders', {
      name: input.name,
      parentId: input.parentId ?? null,
      icon: input.icon ?? null,
      branch: input.branch ?? null,
    });
    return r.id;
  }

  async renameFolder(id: string, name: string): Promise<void> {
    await this.getApi().patch(`/folders/${id}`, { name });
  }

  async moveFolder(id: string, parentId: string | null): Promise<void> {
    await this.getApi().patch(`/folders/${id}`, { parentId });
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
      version: this.options.appVersion ?? '2.0.0',
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
    // 顺序：先文件夹后笔记——笔记的 folderId 指向文件夹，倒序会在服务端
    // 校验/外键场景下失败
    // 错误策略：只跳过 409（已存在，迁移重试幂等）；其他错误（4xx 校验失败 /
    // 5xx / 网络中断）必须上抛——静默吞错会把「导入失败」伪装成成功，用户数据丢失
    const isConflict = (e: unknown): boolean => {
      const status = (e as { err?: { status?: number } })?.err?.status;
      return status === 409;
    };
    for (const folder of payload.folders ?? []) {
      try {
        await this.createFolder({
          name: folder.name,
          parentId: folder.parentId,
          icon: folder.icon,
        });
      } catch (err) {
        if (!isConflict(err)) throw err;
      }
    }
    for (const tag of payload.tags ?? []) {
      try {
        await this.createTag(tag.name, tag.color);
      } catch (err) {
        if (!isConflict(err)) throw err;
      }
    }
    for (const note of payload.notes ?? []) {
      // 跳过回收站笔记：备份里的软删笔记不应在新环境重建为正常笔记
      if (note.deletedAt) continue;
      try {
        await this.createNote({
          ciphertext: note.ciphertext,
          keyVersion: note.keyVersion,
          isPinned: note.isPinned,
          isFavorite: note.isFavorite,
          folderId: note.folderId,
        });
      } catch (err) {
        if (!isConflict(err)) throw err;
      }
    }
    if (payload.preferences) {
      await this.setPreferences(payload.preferences);
    }
  }

  async clearBusinessData(): Promise<void> {
    // 联机模式数据由服务端管理，客户端无需清理（注销时服务端清理 token）
  }
}
