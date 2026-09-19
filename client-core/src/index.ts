/**
 * @dustnote/client-core 入口
 *
 * 跨端客户端内核：把原本只在 web/store.ts 实现的同步编排、离线队列、
 * 加密信封、冲突合并抽成框架无关的纯逻辑，供 web / mobile / miniprogram 共用。
 *
 * 三大架构改进：
 * 1. 存储无关离线队列 + 同步引擎（offline-queue / sync-engine）
 * 2. CryptoBackend 加密适配器接口（crypto-backend）
 * 3. 字段级冲突合并（conflict）—— 消除静默覆盖丢数据
 *
 * 信封格式（envelope）是四端共享的密文包装单一真相源。
 */

// 加密后端适配器
export {
  type CryptoBackend,
  sharedCryptoBackend,
  getCryptoBackend,
  setCryptoBackend,
} from './crypto-backend.js';

// 笔记加密信封
export {
  ENVELOPE_VERSION,
  type NoteCipherEnvelope,
  encryptNote,
  decryptNote,
  parseEnvelope,
} from './envelope.js';

// 字段级冲突合并
export {
  type NoteMetadata,
  type MergeableNote,
  type FieldConflict,
  type ConflictResult,
  resolveConflict,
  toMergeable,
} from './conflict.js';

// 存储无关离线队列
export {
  type HttpMethod,
  type ConflictContext,
  type QueuedOp,
  type QueueStorage,
  MAX_RETRIES,
  getRetryDelay,
  MemoryQueueStorage,
  IndexedDbQueueStorage,
  OfflineQueue,
} from './offline-queue.js';
// 注：OfflineQueue.invalidate() 是实例方法，随类导出

// 同步引擎
export {
  type ServerConflictData,
  type ErrorClass,
  type SyncEngineHooks,
  type FlushSummary,
  SyncEngine,
} from './sync-engine.js';

// 联机模式 Repository（三端共用单一实现，审计 ARCH-002）
export { RemoteRepository, type RemoteRepositoryOptions } from './remote-repository.js';

// i18n 运行时（语言常量 + 取词/插值/回退链）
export {
  type AppLanguage,
  type DictNode,
  type Dictionaries,
  DEFAULT_LANGUAGE,
  FALLBACK_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  isAppLanguage,
  resolveDictKey,
  interpolate,
  createTranslator,
  type TranslatorOptions,
} from './i18n-runtime.js';

// 冲突裁决 store（跨端单一实现，内存态；不落盘明文）
export {
  type PendingConflict,
  type ConflictChoice,
  type ConflictStoreState,
  type ConflictStoreDeps,
  createConflictStore,
} from './conflict-store.js';

// 模式状态 store（跨端单一实现，持久化由平台注入）
export {
  type ModeStoreState,
  type ModeStoreDeps,
  MODE_STORAGE_KEY,
  DEFAULT_MODE_STATE,
  createModeStore,
  toModeState,
} from './mode-store.js';
