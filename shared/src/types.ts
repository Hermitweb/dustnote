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

// ========== v2.0.0 单机/联机双模式相关类型 ==========

/** 应用模式：单机（无服务器）或联机（连接服务器） */
export type AppMode = 'standalone' | 'online';

/** 客户端存储的笔记行（与 web/src/lib/store.ts NoteRow 对齐） */
export interface NoteRow {
  id: NoteId;
  /** 密文 JSON 字符串（服务端存的格式） */
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

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

export type ThemeId =
  | 'mint-dawn'
  | 'mist-blue'
  | 'dusk-forest'
  | 'caramel-warm'
  | 'sakura-pink'
  | 'minimal-white';

export type AppearanceMode = 'light' | 'dark' | 'auto';

export interface Preferences {
  theme: ThemeId;
  mode: AppearanceMode;
  font: 'system' | 'manrope' | 'lxgw';
  density: 'comfortable' | 'standard' | 'compact';
  autoLock: number;
  language: 'zh-CN' | 'en';
}

/**
 * 单机模式本地鉴权 blob（持久化到本地存储）
 *
 * 设计要点（v2 协议）：
 * - masterKey 是随机 32 字节（generateMasterKey），**不**从密码派生
 *   → recover 时可保留原 masterKey，已有笔记不解密失效
 * - masterKey 有两份包装：
 *   1. passwordWrappedMasterKey：用 passwordKek（=deriveSecrets(password, pwSalt).kek）加密
 *   2. wrappedMasterKey：用 recoveryKek（=deriveSecrets(recoveryCode, rcSalt).kek）加密
 * - passwordHash = deriveSecrets(password, pwSalt).authKey 的 base64 —— 仅用于 unlock 时校验密码
 * - recoveryHash = deriveSecrets(recoveryCode, rcSalt).authKey 的 base64 —— 仅用于 recover 时校验恢复码
 *
 * 安全模型：
 * - 一次 Argon2id 同时派生 KEK（包装用）和 authKey（校验用），不做两次昂贵 KDF
 * - 离线爆破 passwordHash 成本高（Argon2id m=64MB t=3 p=4）
 * - 拿到 blob 无法解密笔记（缺少 KEK；authKey 不可逆推 KEK）
 * - recovery 后 masterKey 不变，笔记可继续解密
 * - 恢复码 v2：10 位 Crockford Base32（2^50 熵），与主密码共用强 KDF 参数
 *
 * 兼容性：kdfVersion=1 的旧 blob 无法解锁，需提示用户重新 setup
 */
export interface LocalAuthBlob {
  /** deriveSecrets(password, pwSalt) 派生 KEK + authKey 用的 salt（base64，16 字节随机） */
  pwSalt: string;
  /** deriveSecrets(recoveryCode, rcSalt) 派生 recoveryKEK + recoveryAuthKey 用的 salt（base64，16 字节随机） */
  rcSalt: string;
  /** deriveSecrets(password, pwSalt).authKey 的 base64 —— 仅用于校验密码 */
  passwordHash: string;
  /**
   * passwordKek 加密的 masterKey（JSON 字符串化的 Ciphertext）
   * passwordKek = deriveSecrets(password, pwSalt).kek
   * 用于日常 unlock：校验密码后解封 masterKey
   */
  passwordWrappedMasterKey: string;
  /** deriveSecrets(recoveryCode, rcSalt).authKey 的 base64 —— 仅用于校验恢复码 */
  recoveryHash: string;
  /**
   * recoveryKek 加密的 masterKey（JSON 字符串化的 Ciphertext）
   * recoveryKek = deriveSecrets(normalizeRecoveryCode(recoveryCode), rcSalt).kek
   * 用于 recover 流程：校验恢复码后解封原始 masterKey
   */
  wrappedMasterKey: string;
  /** KDF 版本（v2 = 2；v1 旧数据 = 1，无法解锁需重新 setup） */
  kdfVersion: number;
  /** 创建时间 ISO */
  createdAt: string;
}

/** 模式存储状态 */
export interface ModeState {
  mode: AppMode;
  /** 仅 online 模式有效；null 表示走同源 /api/v1 */
  serverUrl: string | null;
  /** 首次启动是否已选择模式 */
  initialized: boolean;
}
