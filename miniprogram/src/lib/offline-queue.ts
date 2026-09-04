/**
 * 离线队列 — 小程序适配层（v2.5.5 新增，基于 @dustnote/client-core）
 *
 * 联机模式下网络不可用时，把 PATCH / POST 请求缓存到 Taro.setStorage 队列，
 * 网络恢复后自动重放。
 *
 * 说明：
 * - 队列语义、指数退避、409 字段级合并全部由 client-core 的 OfflineQueue +
 *   SyncEngine 提供，本模块仅保留 Taro 存储后端实例化 + 模块函数委托。
 * - 冲突处理：409 时用 conflictCtx 做三方字段级合并并自动 re-PATCH merged
 *   （小程序暂无冲突裁决 UI，merged 默认"冲突字段 local 优先"，严格优于
 *   旧的"提示刷新重试"行为，不丢数据）。
 * - 存储 key 用 client-core 默认的 'dustnote:offline-queue'。
 *
 * 注意：仅联机模式使用（单机模式数据在本地，不存在网络失败）。
 */

import Taro from '@tarojs/taro';
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
import { getApi, useAuthStore } from '../state/auth';
import { useConflictStore } from '../state/conflict-store';

export type OfflineHttpMethod = 'PATCH' | 'POST';

const QUEUE_KEY = 'dustnote:offline-queue';

/** Taro 存储后端（同步 API 包装为异步） */
class TaroQueueStorage implements QueueStorage {
  async load(): Promise<QueuedOp[]> {
    try {
      const raw = Taro.getStorageSync(QUEUE_KEY);
      if (!raw) return [];
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? (parsed as QueuedOp[]) : [];
    } catch {
      return [];
    }
  }

  async save(ops: QueuedOp[]): Promise<void> {
    Taro.setStorageSync(QUEUE_KEY, JSON.stringify(ops));
  }

  async clear(): Promise<void> {
    Taro.removeStorageSync(QUEUE_KEY);
  }
}

const queue = new OfflineQueue(new TaroQueueStorage());

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

/**
 * 409 冲突处理：三方字段级合并（架构改进 #3 的 miniprogram 端落地）
 *
 * 与 mobile 对称：
 * - 无歧义字段自动合并并静默 re-PATCH（不弹 UI）
 * - 有歧义字段（双方都改）推送到 conflict-store，由全局 ConflictDialog 裁决
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
    serverPlain = await decryptNote(masterKey, envelope, noteAad(serverRow.id, userId ?? ''));
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
      await getApi().request('PATCH', `/notes/${ctx.noteId}`, {
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
  replayOp: (op) => getApi().request(op.method, op.path, op.body),
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

/** 重放离线队列；返回是否仍有剩余条目 */
export async function flushOfflineQueue(): Promise<boolean> {
  const before = await queue.size();
  const summary = await engine.flush();
  // 有成功重放:广播数据变更,让在线页面立即校正本地视图
  // (否则 UI 停留在旧数据直到手动重进页面)
  if (before > summary.remaining) {
    try {
      Taro.eventCenter.trigger('dustnote:data-changed', { replayed: before - summary.remaining });
    } catch {
      /* ignore */
    }
  }
  return summary.remaining > 0;
}
