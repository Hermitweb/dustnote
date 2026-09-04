/**
 * 离线队列 — mobile 适配层（v2.5.5 迁移到 @dustnote/client-core）
 *
 * 联机模式下网络不可用时，把 PATCH / POST 请求缓存到 AsyncStorage 队列，
 * 网络恢复后（列表加载成功 / 保存成功时）自动重放。
 *
 * 迁移说明：
 * - 队列语义、指数退避、409 字段级合并全部由 client-core 的 OfflineQueue +
 *   SyncEngine 提供，本模块仅保留 AsyncStorage 后端实例化 + 模块函数委托。
 * - 保留旧存储 key（dustnote_offline_queue），并在 load 时做旧格式→新格式
 *   迁移（queuedAt/attempts → createdAt/retries），已有 pending 队列无缝继承。
 * - 冲突处理：409 时用 conflictCtx 做三方字段级合并并自动 re-PATCH merged
 *   （mobile 暂无冲突裁决 UI，merged 默认"冲突字段 local 优先"，严格优于旧
 *   的"静默丢弃"行为，不丢数据）。
 *
 * 注意：
 * - 仅联机模式使用（单机模式数据在本地，不存在网络失败）
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  OfflineQueue,
  SyncEngine,
  parseEnvelope,
  decryptNote,
  encryptNote,
  resolveConflict,
  toMergeable,
  type QueueStorage,
  type QueuedOp,
  type ConflictContext,
  type ErrorClass,
} from '@dustnote/client-core';
import { noteAad, type ApiException } from '@dustnote/shared';
import { api } from '../api';
import { useAuthStore } from '../state/auth';
import { useConflictStore } from '../state/conflict-store';

// 与旧实现一致：仅 PATCH / POST（DELETE 暂未走离线队列）
export type OfflineHttpMethod = 'PATCH' | 'POST';

/** 旧格式队列条目（v2.5.4 之前），用于 load 时迁移 */
interface LegacyOfflineQueueItem {
  method: OfflineHttpMethod;
  path: string;
  body: unknown;
  queuedAt: string;
  attempts: number;
}

/** 旧存储 key 保持不变，避免已有 pending 队列丢失 */
const QUEUE_KEY = 'dustnote_offline_queue';

/**
 * AsyncStorage 存储后端：load 时兼容迁移旧格式条目。
 */
class AsyncStorageQueueStorage implements QueueStorage {
  private readonly key: string;

  constructor(key = QUEUE_KEY) {
    this.key = key;
  }

  async load(): Promise<QueuedOp[]> {
    try {
      const raw = await AsyncStorage.getItem(this.key);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return (parsed as Array<QueuedOp | LegacyOfflineQueueItem>).map(migrateItem);
    } catch {
      return [];
    }
  }

  async save(ops: QueuedOp[]): Promise<void> {
    await AsyncStorage.setItem(this.key, JSON.stringify(ops));
  }

  async clear(): Promise<void> {
    await AsyncStorage.removeItem(this.key);
  }
}

/** 旧格式 → 新格式迁移：queuedAt/attempts → createdAt/retries，补 id */
function migrateItem(item: QueuedOp | LegacyOfflineQueueItem): QueuedOp {
  if ('id' in item && 'createdAt' in item && 'retries' in item) {
    return item as QueuedOp;
  }
  const legacy = item as LegacyOfflineQueueItem;
  return {
    id: `${legacy.queuedAt}-${Math.random().toString(36).slice(2, 8)}`,
    method: legacy.method,
    path: legacy.path,
    body: legacy.body,
    createdAt: legacy.queuedAt,
    retries: legacy.attempts,
  };
}

const queue = new OfflineQueue(new AsyncStorageQueueStorage());

/** 是否网络类错误（fetch 底层 TypeError / 状态 0 / 网络错误消息） */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const e = err as { name?: string; status?: number; message?: string };
  if (e.name === 'TypeError') return true;
  if (typeof e.status === 'number' && e.status === 0) return true;
  if (
    typeof e.message === 'string' &&
    /network request failed|network error|fetch failed/i.test(e.message)
  ) {
    return true;
  }
  return false;
}

/**
 * 409 冲突处理：三方字段级合并（架构改进 #3）。
 *
 * mobile 无冲突裁决 UI，这里统一走"自动合并 + re-PATCH"：
 * - 无歧义字段自动合并
 * - 有歧义字段（双方都改）merged 取 local（保住本地未保存编辑）
 * - re-PATCH 用 server version 作为乐观锁
 *
 * 任何步骤失败都静默放弃（op 随后被 SyncEngine 移除），
 * 避免阻塞队列；本地编辑已在 merged 中尽量保留。
 */
async function handleConflict(op: QueuedOp, serverData: unknown): Promise<void> {
  const ctx = op.conflictCtx;
  if (!ctx) return;

  const { masterKey, userId } = useAuthStore.getState();
  if (!masterKey) return;

  const body = serverData as { current?: ServerNoteRow } | undefined;
  const serverRow = body?.current;
  if (!serverRow) return;

  let serverPlain: { title: string; content: string; tags: string[] };
  try {
    const envelope = parseEnvelope(serverRow.ciphertext);
    serverPlain = await decryptNote(
        masterKey,
        envelope,
        envelope.payload.a === 1 ? noteAad(serverRow.id, userId ?? '') : undefined,
      );
  } catch {
    return;
  }

  const serverMergeable = toMergeable(serverRow.id, serverPlain, {
    isPinned: serverRow.isPinned,
    isFavorite: serverRow.isFavorite,
    deletedAt: serverRow.deletedAt,
    folderId: serverRow.folderId,
    clientUpdatedAt: serverRow.clientUpdatedAt,
  });

  const result = resolveConflict(ctx.base, ctx.local, serverMergeable);

  if (!result.hasConflicts) {
    // 无歧义：自动 re-PATCH 合并结果（静默，无 UI）
    try {
      const { json: cipherJson } = await encryptNote(
        masterKey,
        result.merged.plaintext,
        noteAad(ctx.noteId, userId ?? '')
      );
      await api.request('PATCH', `/notes/${ctx.noteId}`, {
        ciphertext: cipherJson,
        keyVersion: 1,
        isPinned: result.merged.isPinned,
        isFavorite: result.merged.isFavorite,
        folderId: result.merged.folderId,
        deletedAt: result.merged.deletedAt,
        clientUpdatedAt: new Date().toISOString(),
        version: serverRow.version,
      });
    } catch {
      /* re-PATCH 失败（再次 409 / 网络故障）：放弃，下次 loadAll 校正 */
    }
    return;
  }

  // 有歧义：推到冲突 store，由 UI 裁决（不再自动 re-PATCH）
  useConflictStore.getState().enqueueConflict({
    noteId: ctx.noteId,
    title: ctx.local.plaintext.title || serverMergeable.plaintext.title || '',
    conflicts: result.conflicts,
    merged: result.merged,
    local: ctx.local,
    server: serverMergeable,
    serverVersion: serverRow.version,
  });
}

/** 服务端 409 响应里的 current NoteRow（字段与 shared NoteRow 对齐） */
interface ServerNoteRow {
  id: string;
  version: number;
  isPinned: boolean;
  isFavorite: boolean;
  deletedAt: string | null;
  ciphertext: string;
  keyVersion: number;
  clientUpdatedAt: string;
  folderId: string | null;
  serverUpdatedAt: string;
}

/** 错误分类：ApiException → status/data；网络错误 → status undefined（break） */
function classifyError(err: unknown): ErrorClass | null {
  const apiErr = err as ApiException;
  if (apiErr && typeof apiErr === 'object' && apiErr.err && typeof apiErr.err.status === 'number') {
    return { status: apiErr.err.status, data: apiErr.err.data };
  }
  if (isNetworkError(err)) {
    return { status: undefined, data: undefined };
  }
  return null;
}

const engine = new SyncEngine(queue, {
  replayOp: (op) => api.request(op.method, op.path, op.body),
  onConflict: async (op, serverData) => {
    await handleConflict(op, serverData);
    return true;
  },
  classifyError,
});

/**
 * 入队一个待同步请求（保存失败时调用）。
 *
 * @param opts.noteId 关联笔记 id（PATCH /notes/:id 传，冲突合并需要）
 * @param opts.conflictCtx 三方合并上下文（base + local），409 时字段级合并用
 */
export async function enqueueOffline(
  method: OfflineHttpMethod,
  path: string,
  body: unknown,
  opts?: { noteId?: string; conflictCtx?: ConflictContext }
): Promise<void> {
  await queue.enqueue({
    method,
    path,
    body,
    ...(opts?.noteId ? { noteId: opts.noteId } : {}),
    ...(opts?.conflictCtx ? { conflictCtx: opts.conflictCtx } : {}),
  });
}

/** 队列中待同步条目数 */
export async function pendingOfflineCount(): Promise<number> {
  return queue.size();
}

/**
 * 重放离线队列。网络恢复后调用（如列表加载成功 / 保存成功后）。
 * 返回是否仍有剩余条目（true = 网络仍不可用或 5xx 保留，下次再试）。
 */
export async function flushOfflineQueue(): Promise<boolean> {
  const summary = await engine.flush();
  return summary.remaining > 0;
}

// 供可能的跨页面失效使用（移动端单进程，一般不需要）
export function invalidateQueue(): void {
  queue.invalidate();
}
