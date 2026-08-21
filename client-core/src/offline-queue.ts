/**
 * 存储无关的离线同步队列（架构改进 #1 基座）
 *
 * 旧实现（web/src/lib/offline-queue.ts）硬绑死 IndexedDB（idb-keyval）+
 * BroadcastChannel，mobile/miniprogram 只能各自重写一套。本模块把队列
 * 语义与存储后端解耦：
 * - QueueStorage 接口：load / save / clear 三个方法，任何 KV 存储都能实现
 * - OfflineQueue 类：封装 enqueue/peek/remove/bumpRetries/退避 等队列语义，
 *   与 web 原有模块函数签名对齐，便于 web 零改动委托
 * - MemoryQueueStorage：内存实现，测试 + 作为 RN(MMKV)/Taro 适配器的基类
 * - IndexedDbQueueStorage：原生 IndexedDB 实现，DB/store/key 与 idb-keyval
 *   默认一致（'keyval-store'/'keyval'，key='dustnote:offline-queue'），
 *   web 切换后已有 pending 队列无缝继承
 *
 * 队列项新增可选 conflictCtx 字段：PATCH /notes/:id 入队时携带三方合并
 * 上下文（base + local 明文/元数据），供 SyncEngine 在 409 时做字段级合并。
 */

import type { MergeableNote } from './conflict.js';

export type HttpMethod = 'POST' | 'PATCH' | 'DELETE';

/** 409 三方合并上下文（仅 PATCH /notes/:id 携带） */
export interface ConflictContext {
  noteId: string;
  /** 入队时客户端持有的版本号（= body.version，公共祖先版本） */
  baseVersion: number;
  /** 公共祖先明文 + 元数据 */
  base: MergeableNote;
  /** 客户端编辑后明文 + 元数据 */
  local: MergeableNote;
}

export interface QueuedOp {
  /** 客户端生成的唯一 id（去重/取消用） */
  id: string;
  method: HttpMethod;
  path: string;
  body?: unknown;
  /** 关联笔记 id（UI 提示与冲突处理用） */
  noteId?: string;
  createdAt: string;
  /** 重试次数（超阈值放弃） */
  retries: number;
  /** v2.5.5：三方合并上下文，仅 PATCH /notes/:id 携带 */
  conflictCtx?: ConflictContext;
}

/** 最大重试次数（总等待约 5 分钟） */
export const MAX_RETRIES = 8;

/**
 * 指数退避延迟：delay = min(30s, 1s * 2^attempt) + 随机抖动（0~500ms）
 */
export function getRetryDelay(attempt: number): number {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}

/** 生成 op id：时间戳 + 随机后缀，避免同一毫秒冲突 */
function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 队列存储后端契约。任何能持久化 QueuedOp[] 的 KV 存储都能实现：
 * - web：IndexedDbQueueStorage
 * - RN：封装 MMKV / AsyncStorage
 * - Taro：封装 Taro.setStorage / getStorage
 */
export interface QueueStorage {
  load(): Promise<QueuedOp[]>;
  save(ops: QueuedOp[]): Promise<void>;
  clear(): Promise<void>;
}

/** 内存存储（测试 + RN/Taro 适配器基类） */
export class MemoryQueueStorage implements QueueStorage {
  private ops: QueuedOp[] = [];
  async load(): Promise<QueuedOp[]> {
    return [...this.ops];
  }
  async save(ops: QueuedOp[]): Promise<void> {
    this.ops = [...ops];
  }
  async clear(): Promise<void> {
    this.ops = [];
  }
}

/**
 * 原生 IndexedDB 存储，与 idb-keyval 默认 DB/store 一致，
 * web 切换后已有 pending 队列无缝继承。
 *
 * 不依赖 idb-keyval，client-core 保持零运行时依赖（仅 @dustnote/shared）。
 */
export class IndexedDbQueueStorage implements QueueStorage {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly key: string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    key = 'dustnote:offline-queue',
    dbName = 'keyval-store',
    storeName = 'keyval'
  ) {
    this.key = key;
    this.dbName = dbName;
    this.storeName = storeName;
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB 不可用'));
        return;
      }
      const req = indexedDB.open(this.dbName);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open 失败'));
    });
    return this.dbPromise;
  }

  private async tx<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const db = await this.openDb();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(this.storeName, mode);
      const store = tx.objectStore(this.storeName);
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 事务失败'));
    });
  }

  async load(): Promise<QueuedOp[]> {
    try {
      const v = await this.tx<unknown>('readonly', (s) => s.get(this.key));
      return Array.isArray(v) ? (v as QueuedOp[]) : [];
    } catch {
      return [];
    }
  }

  async save(ops: QueuedOp[]): Promise<void> {
    await this.tx('readwrite', (s) => s.put(ops, this.key));
  }

  async clear(): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(this.key));
  }
}

/**
 * 离线队列：封装队列语义，与 web 原 offline-queue.ts 模块函数对齐。
 *
 * 内存缓存懒加载，变更后同步持久化；跨标签页广播由调用方按需接入
 *（web 可在 save 后 postMessage BroadcastChannel，语义不变）。
 */
export class OfflineQueue {
  private cache: QueuedOp[] | null = null;

  constructor(private readonly storage: QueueStorage) {}

  /** 从存储加载到内存（懒加载，仅一次） */
  private async ensureLoaded(): Promise<QueuedOp[]> {
    if (this.cache) return this.cache;
    this.cache = await this.storage.load();
    return this.cache;
  }

  private async persist(): Promise<void> {
    if (this.cache) await this.storage.save(this.cache);
  }

  /** 入队 */
  async enqueue(
    op: Omit<QueuedOp, 'id' | 'createdAt' | 'retries'>
  ): Promise<QueuedOp> {
    const queue = await this.ensureLoaded();
    const full: QueuedOp = {
      ...op,
      id: genId(),
      createdAt: new Date().toISOString(),
      retries: 0,
    };
    queue.push(full);
    await this.persist();
    return full;
  }

  /** 查看队首（不移除） */
  async peek(): Promise<QueuedOp | undefined> {
    const queue = await this.ensureLoaded();
    return queue[0];
  }

  /** 查看全部（UI 显示 pending 数量用） */
  async peekAll(): Promise<QueuedOp[]> {
    const queue = await this.ensureLoaded();
    return [...queue];
  }

  /** 移除指定 id 的 op（成功或永久放弃时调用） */
  async remove(id: string): Promise<void> {
    const queue = await this.ensureLoaded();
    const idx = queue.findIndex((op) => op.id === id);
    if (idx >= 0) {
      queue.splice(idx, 1);
      await this.persist();
    }
  }

  /** 增加某 op 重试计数；超阈值则移除 */
  async bumpRetries(id: string, max = MAX_RETRIES): Promise<void> {
    const queue = await this.ensureLoaded();
    const op = queue.find((o) => o.id === id);
    if (!op) return;
    op.retries += 1;
    if (op.retries >= max) {
      await this.remove(id);
    } else {
      await this.persist();
    }
  }

  /** 获取某 op 的下次重试延迟（ms） */
  async getRetryDelayForOp(id: string): Promise<number> {
    const queue = await this.ensureLoaded();
    const op = queue.find((o) => o.id === id);
    if (!op) return 0;
    return getRetryDelay(op.retries);
  }

  /** 清空整个队列 */
  async clear(): Promise<void> {
    this.cache = [];
    await this.storage.clear();
  }

  /** 当前队列长度 */
  async size(): Promise<number> {
    const queue = await this.ensureLoaded();
    return queue.length;
  }

  /**
   * 丢弃内存缓存，下次访问重新从存储加载。
   *
   * 供跨标签页/跨进程同步用：web 端收到 BroadcastChannel 通知后调用，
   * 使本标签页的队列视图与其它标签页保持一致。
   */
  invalidate(): void {
    this.cache = null;
  }
}
