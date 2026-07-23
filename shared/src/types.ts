/**
 * DustNote 公共类型定义
 */

export type NoteId = string;
export type ShareId = string;
export type TagId = string;
export type DeviceId = string;
export type UserId = string;

/** 笔记密文包装（与 crypto.Ciphertext 对齐） */
export interface EncryptedBlob {
  /** 算法版本 */
  v: number;
  /** 密钥版本（用于双版本解密迁移） */
  k: number;
  /** AES-GCM nonce / IV（base64） */
  n: string;
  /** 密文（base64，已包含认证标签） */
  c: string;
}

/** 服务端 ↔ 客户端传输的笔记密文行 */
export interface Note {
  id: NoteId;
  /** 整份笔记密文（服务端存 ciphertext 列，客户端解密后得到 NotePlaintext） */
  ciphertext: EncryptedBlob | string;
  /** 密钥版本 */
  keyVersion: number;
  /** 是否置顶 */
  isPinned: boolean;
  /** 是否收藏 */
  isFavorite: boolean;
  /** 软删除时间，null = 未删除 */
  deletedAt: string | null;
  /** 版本号（乐观锁） */
  version: number;
  /** 客户端时间戳 */
  clientUpdatedAt: string;
  /** 服务端时间戳 */
  serverUpdatedAt: string;
  /** 所属文件夹 ID */
  folderId: string | null;
}

/** 客户端内存中的笔记明文 */
export interface NotePlaintext {
  title: string;
  content: string;
  tags: string[];
}

export interface NoteMeta {
  id: NoteId;
  serverUpdatedAt: string;
  clientUpdatedAt: string;
  isPinned: boolean;
  isFavorite: boolean;
  deletedAt: string | null;
  version: number;
}

export interface Share {
  id: ShareId;
  noteId: NoteId;
  /** 分享 token（URL 友好） */
  token: string;
  /** 创建时间 */
  createdAt: string;
  /** 过期时间，null = 永久 */
  expiresAt: string | null;
  /** 是否需要密码 */
  hasPassword: boolean;
  /** 查看次数 */
  viewCount: number;
  /** 是否已吊销 */
  revoked: boolean;
}

export interface UserPreferences {
  theme:
    | 'mint-dawn'
    | 'mist-blue'
    | 'dusk-forest'
    | 'caramel-warm'
    | 'sakura-pink'
    | 'minimal-white';
  mode: 'light' | 'dark' | 'auto';
  font: 'system' | 'manrope' | 'lxgw';
  density: 'comfortable' | 'standard' | 'compact';
  autoLockMinutes: number;
  language: 'zh-CN' | 'zh-TW' | 'en';
}

export interface Device {
  id: DeviceId;
  name: string;
  platform: 'web' | 'desktop' | 'android' | 'ios' | 'miniprogram';
  /** 设备指纹哈希 */
  fingerprint: string;
  lastActiveAt: string;
  createdAt: string;
}

export interface ConflictRecord {
  entity: 'note' | 'share';
  id: string;
  reason: 'version_mismatch' | 'already_deleted' | 'permission_denied';
  serverVersion: number;
  clientVersion: number;
  serverData?: Note;
}
