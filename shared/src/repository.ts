/**
 * DataRepository 接口契约（v2.0.0 单机/联机双模式核心抽象）
 *
 * 设计意图：
 * - 客户端 store/state 不再直接持有 ApiClient，而是持有 DataRepository
 * - 各端启动时根据 AppMode 注入不同实现：
 *   - standalone → local-repo（IndexedDB / MMKV / Taro.setStorage）
 *   - online     → remote-repo（封装 ApiClient + 离线队列）
 * - 接口对齐 web/src/lib/store.ts 现有 action 签名，确保 store.ts 重构时仅需替换 api() 调用入口
 *
 * 不含鉴权方法（setup/unlock/lock/recover）——这些由 mode-store + auth-store 处理，
 * 因为单机模式走 local-auth.ts（本地 Argon2id 比对），联机模式走 /auth/* API，
 * 两条路径差异较大，不适合统一到 Repository 中。
 *
 * 数据加密说明：
 * - Repository 处理的是**密文行**（NoteRow.ciphertext 是 JSON 字符串）
 * - 加解密在 store 层完成（encryptNote / decryptNote），Repository 不感知明文
 * - 这样单机模式和联机模式的数据安全模型一致：本地/服务端都只存密文
 */

import type { NoteRow, Folder, Tag, Preferences } from './types.js';

/** Repository 加载的全部数据（对齐 StoreState 的数据部分） */
export interface RepositorySnapshot {
  notes: NoteRow[];
  folders: Folder[];
  tags: Tag[];
  preferences: Preferences | null;
}

/** 创建笔记的入参 */
export interface CreateNoteInput {
  /** 密文 JSON 字符串 */
  ciphertext: string;
  keyVersion: number;
  isPinned?: boolean;
  isFavorite?: boolean;
  folderId?: string | null;
}

/** 更新笔记的入参（部分字段） */
export interface UpdateNoteInput {
  ciphertext?: string;
  keyVersion?: number;
  isPinned?: boolean;
  isFavorite?: boolean;
  folderId?: string | null;
  /** 软删除时间，null = 未删除；设置非 null 表示移入回收站 */
  deletedAt?: string | null;
  /** 恢复笔记时设为 null */
  version?: number;
}

/** 创建文件夹的入参 */
export interface CreateFolderInput {
  name: string;
  parentId?: string | null;
  icon?: string | null;
}

/** 全量备份导出结构（用于模式迁移 + 数据备份） */
export interface BackupPayload {
  version: string;
  exportedAt: string;
  notes: NoteRow[];
  folders: Folder[];
  tags: Tag[];
  preferences: Preferences | null;
  /** 来源模式：standalone / online */
  source: 'standalone' | 'online';
}

/**
 * DataRepository 接口契约
 *
 * 实现方：
 * - web/src/lib/local-repo.ts（IndexedDB）
 * - web/src/lib/remote-repo.ts（封装 ApiClient）
 * - mobile/src/lib/local-repo.ts（MMKV）
 * - mobile/src/lib/remote-repo.ts（封装 api）
 * - miniprogram/src/lib/local-repo.ts（Taro.setStorage）
 * - miniprogram/src/lib/remote-repo.ts（封装 getApi()）
 */
export interface DataRepository {
  /** 标识当前实现类型，便于调试 */
  readonly kind: 'local' | 'remote';

  // ========== 批量加载 ==========

  /** 加载全部数据（笔记含已软删的） */
  loadAll(): Promise<RepositorySnapshot>;

  // ========== 笔记 CRUD ==========

  /** 创建笔记，返回新笔记 id */
  createNote(input: CreateNoteInput): Promise<string>;

  /** 更新笔记（部分字段）；返回最新版本号 */
  updateNote(id: string, input: UpdateNoteInput): Promise<number>;

  /** 移动笔记到指定文件夹（null = 移出文件夹） */
  moveNote(id: string, folderId: string | null): Promise<void>;

  /** 软删除笔记（移入回收站） */
  deleteNote(id: string): Promise<void>;

  /** 永久删除笔记（不可恢复） */
  permanentDeleteNote(id: string): Promise<void>;

  /** 恢复笔记（从回收站还原） */
  restoreNote(id: string): Promise<void>;

  /** 清空回收站：永久删除所有已软删的笔记 */
  emptyTrash(): Promise<void>;

  // ========== 文件夹 ==========

  /** 创建文件夹，返回新文件夹 id */
  createFolder(input: CreateFolderInput): Promise<string>;

  /** 删除文件夹（笔记的 folderId 会被置为 null） */
  deleteFolder(id: string): Promise<void>;

  // ========== 标签 ==========

  /** 创建标签，返回新标签 id */
  createTag(name: string, color?: string | null): Promise<string>;

  /** 删除标签 */
  deleteTag(id: string): Promise<void>;

  // ========== 偏好设置 ==========

  /** 获取偏好设置 */
  getPreferences(): Promise<Preferences | null>;

  /** 更新偏好设置（部分字段） */
  setPreferences(partial: Partial<Preferences>): Promise<void>;

  // ========== 备份与迁移 ==========

  /** 导出全量备份（用于模式迁移或用户备份） */
  exportBackup(): Promise<BackupPayload>;

  /** 导入全量备份（用于模式迁移或用户恢复） */
  importBackup(payload: BackupPayload): Promise<void>;

  /** 清空所有业务数据（保留鉴权信息）；用于注销或切换模式前清理 */
  clearBusinessData(): Promise<void>;
}

/**
 * Repository 工厂配置
 */
export interface RepositoryFactoryOptions {
  /** 当前模式 */
  mode: 'standalone' | 'online';
  /** 联机模式下的服务器 URL（standalone 模式忽略） */
  serverUrl?: string | null;
  /** 访问令牌（联机模式必需） */
  accessToken?: string | null;
  /** 设备 ID（联机模式必需） */
  deviceId?: string | null;
}

/**
 * Repository 工厂函数签名（各端实现并注入）
 *
 * 各端在 lib/repository.ts 中实现此工厂，根据 mode 返回 local-repo 或 remote-repo。
 * 工厂内部处理依赖注入（如 IndexedDB 实例、ApiClient 实例等）。
 */
export type RepositoryFactory = (opts: RepositoryFactoryOptions) => DataRepository;
