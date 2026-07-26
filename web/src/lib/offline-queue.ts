/**
 * 离线同步队列
 *
 * 设计：
 * - 网络失败时把 mutation 入队，UI 已乐观更新，用户无感知
 * - 联网或 WS 重连时逐条重放
 * - 409 冲突时丢弃该 op（服务端版本更新），由 loadAll() 拉取最新
 * - 队列持久化到 IndexedDB，刷新不丢
 *
 * 不做的事：
 * - 不做 CRDT/合并；同一笔记的多条 op 顺序重放即可
 * - 不做指数退避（用户可手动重试）
 */

import { del, get, set } from 'idb-keyval';

const QUEUE_KEY = 'dustnote:offline-queue';

export type HttpMethod = 'POST' | 'PATCH' | 'DELETE';

export interface QueuedOp {
  /** 客户端生成的唯一 id（用于去重/取消） */
  id: string;
  method: HttpMethod;
  path: string;
  body?: unknown;
  /** 关联的笔记 id（用于 UI 提示与冲突处理） */
  noteId?: string;
  createdAt: string;
  /** 重试次数（超过阈值放弃） */
  retries: number;
}

let memQueue: QueuedOp[] | null = null;

/** 从 IndexedDB 加载队列到内存（懒加载，仅一次） */
async function ensureLoaded(): Promise<QueuedOp[]> {
  if (memQueue) return memQueue;
  const persisted = await get<QueuedOp[]>(QUEUE_KEY);
  memQueue = persisted ?? [];
  return memQueue;
}

/** 内存队列变更后同步到 IndexedDB */
async function persist(): Promise<void> {
  if (memQueue) await set(QUEUE_KEY, memQueue);
}

/** 生成 op id：时间戳 + 随机后缀，避免同一毫秒冲突 */
function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 入队 */
export async function enqueue(
  op: Omit<QueuedOp, 'id' | 'createdAt' | 'retries'>
): Promise<QueuedOp> {
  const queue = await ensureLoaded();
  const full: QueuedOp = {
    ...op,
    id: genId(),
    createdAt: new Date().toISOString(),
    retries: 0,
  };
  queue.push(full);
  await persist();
  return full;
}

/** 查看队首（不移除） */
export async function peek(): Promise<QueuedOp | undefined> {
  const queue = await ensureLoaded();
  return queue[0];
}

/** 查看全部（用于 UI 显示 pending 数量） */
export async function peekAll(): Promise<QueuedOp[]> {
  const queue = await ensureLoaded();
  return [...queue];
}

/** 移除指定 id 的 op（成功或永久放弃时调用） */
export async function remove(id: string): Promise<void> {
  const queue = await ensureLoaded();
  const idx = queue.findIndex((op) => op.id === id);
  if (idx >= 0) {
    queue.splice(idx, 1);
    await persist();
  }
}

/** 增加某 op 的重试计数；超过阈值则移除 */
export async function bumpRetries(id: string, max = 5): Promise<void> {
  const queue = await ensureLoaded();
  const op = queue.find((o) => o.id === id);
  if (!op) return;
  op.retries += 1;
  if (op.retries >= max) {
    await remove(id);
  } else {
    await persist();
  }
}

/** 清空整个队列 */
export async function clear(): Promise<void> {
  memQueue = [];
  await del(QUEUE_KEY);
}

/** 当前队列长度（轻量查询，不返回完整对象） */
export async function size(): Promise<number> {
  const queue = await ensureLoaded();
  return queue.length;
}
