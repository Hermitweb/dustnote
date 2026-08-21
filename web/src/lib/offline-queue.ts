/**
 * 离线同步队列 — web 适配层
 *
 * v2.5.5：队列语义已抽到 @dustnote/client-core（OfflineQueue + QueueStorage），
 * 本模块仅保留 web 特有的 IndexedDB 后端实例化 + BroadcastChannel 跨标签页失效，
 * 模块函数签名与旧实现完全一致，store.ts 零改动委托。
 *
 * 设计：
 * - 网络失败时把 mutation 入队，UI 已乐观更新，用户无感知
 * - 联网或 WS 重连时逐条重放
 * - 409 冲突时丢弃该 op（服务端版本更新），由 loadAll() 拉取最新
 * - 队列持久化到 IndexedDB，刷新不丢
 * - 指数退避重试：delay = min(30s, 1s * 2^attempt) + jitter，最高 8 次
 * - PATCH /notes/:id 入队时携带 conflictCtx（三方合并上下文），
 *   供 flushQueue 409 分支做字段级合并（见 store.ts handleNoteConflict）
 */

import {
  IndexedDbQueueStorage,
  OfflineQueue,
  MAX_RETRIES,
  getRetryDelay,
  type HttpMethod,
  type QueuedOp,
  type ConflictContext,
} from '@dustnote/client-core';

// Re-export types for store.ts convenience
export { MAX_RETRIES, getRetryDelay };
export type { HttpMethod, QueuedOp, ConflictContext };

/**
 * 单例 OfflineQueue：IndexedDB 存储，DB/store/key 与 idb-keyval 默认一致
 *（'keyval-store'/'keyval'，key='dustnote:offline-queue'），
 * web 切换后已有 pending 队列无缝继承，无需数据迁移。
 */
const storage = new IndexedDbQueueStorage();
const queue = new OfflineQueue(storage);

/**
 * 跨标签页同步：其它标签页入队后广播通知，本标签页丢弃内存缓存，
 * 下次访问时重新从 IndexedDB 加载。
 */
if (typeof BroadcastChannel !== 'undefined') {
  const bc = new BroadcastChannel('dustnote-queue');
  bc.onmessage = () => queue.invalidate();
}

// ========== 模块函数委托（与旧签名对齐，store.ts 无需改动） ==========

/** 入队（同时广播通知其它标签页失效缓存） */
export async function enqueue(
  op: Omit<QueuedOp, 'id' | 'createdAt' | 'retries'>
): Promise<QueuedOp> {
  const full = await queue.enqueue(op);
  if (typeof BroadcastChannel !== 'undefined') {
    // 每次创建新实例是旧实现的行为；保持一致避免遗漏 listener 注册
    new BroadcastChannel('dustnote-queue').postMessage({ type: 'enqueued' });
  }
  return full;
}

/** 查看队首（不移除） */
export function peek(): Promise<QueuedOp | undefined> {
  return queue.peek();
}

/** 查看全部（用于 UI 显示 pending 数量） */
export function peekAll(): Promise<QueuedOp[]> {
  return queue.peekAll();
}

/** 移除指定 id 的 op（成功或永久放弃时调用） */
export function remove(id: string): Promise<void> {
  return queue.remove(id);
}

/** 增加某 op 的重试计数；超过阈值则移除 */
export function bumpRetries(id: string, max = MAX_RETRIES): Promise<void> {
  return queue.bumpRetries(id, max);
}

/** 获取某 op 的下次重试延迟（ms），用于 flushQueue 中的 setTimeout */
export function getRetryDelayForOp(id: string): Promise<number> {
  return queue.getRetryDelayForOp(id);
}

/** 清空整个队列 */
export function clear(): Promise<void> {
  return queue.clear();
}

/** 当前队列长度（轻量查询，不返回完整对象） */
export function size(): Promise<number> {
  return queue.size();
}
