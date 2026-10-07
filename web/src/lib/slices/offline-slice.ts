/**
 * Offline Slice — 在线状态、离线队列、冲突解决
 */

import type { StateCreator } from 'zustand';
import { ApiException } from '@dustnote/shared';
import {
  encryptNote,
  decryptNote,
  parseEnvelope,
  resolveConflict,
  toMergeable,
  type NoteMetadata,
} from '@dustnote/client-core';
import type { StoreState } from '../store';
import type { PendingConflict, NoteRow, NotePlaintext } from '../store-types';
import { flushingRef, replayOp, api, cacheNotesLocal } from '../store-helpers';
import {
  peekAll,
  remove,
  bumpRetries,
  getRetryDelayForOp,
  size as queueSize,
} from '../offline-queue';
import { clearCache } from '../db';
import { clearGraceUnlock } from '../grace-unlock';
import { clearLocalAuthBlob, clearLockoutState } from '../local-auth-storage';
import { noteAad } from '@dustnote/shared';
import { INITIAL_LOCKOUT_STATE } from '@dustnote/shared';

export interface OfflineSlice {
  isOnline: boolean;
  pendingCount: number;
  pendingConflicts: PendingConflict[];
  setOnline: (online: boolean) => void;
  refreshPendingCount: () => Promise<void>;
  flushQueue: () => Promise<void>;
  clearLocalData: () => Promise<void>;
  resolveConflictChoice: (noteId: string, choice: 'local' | 'server' | 'merged') => Promise<void>;
  dismissConflict: (noteId: string) => void;
}

export const createOfflineSlice: StateCreator<StoreState, [], [], OfflineSlice> = (set, get) => ({
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pendingCount: 0,
  pendingConflicts: [],

  setOnline(online: boolean): void {
    set({ isOnline: online } as Partial<StoreState>);
    if (online) {
      void get().refreshPendingCount();
    }
  },

  async refreshPendingCount(): Promise<void> {
    try {
      const n = await queueSize();
      set({ pendingCount: n } as Partial<StoreState>);
    } catch {
      /* ignore */
    }
  },

  async flushQueue(): Promise<void> {
    if (flushingRef.inFlight) return;
    flushingRef.inFlight = true;
    try {
      const ops = await peekAll();
      if (ops.length === 0) return;

      let hadConflict = false;
      let rateLimited = false;
      let authHalt = false;
      for (const op of ops) {
        try {
          await replayOp(op);
          await remove(op.id);
        } catch (err) {
          if (err instanceof ApiException) {
            const status = err.err.status;
            if (status === 409) {
              if (op.conflictCtx) {
                try {
                  await handleNoteConflict(op, err);
                } catch {
                  /* fallback to loadAll */
                }
              }
              await remove(op.id);
              hadConflict = true;
            } else if (status >= 400 && status < 500) {
              // C-H（2026-10 审计）：401/403 是**账号级**状态而非 op 级缺陷。
              // 此前 bumpRetries 每轮 flush 烧一次重试预算，到 MAX_RETRIES 后
              // op 被静默删除——与注释「保留待解锁后重放,不丢数据」自相矛盾。
              // 对齐 M3(429) 的正确模式：不消耗重试预算,中止本轮,队列完整保留,
              // 解锁/重新登录后的下一次 flush 自然重放。
              if (status === 401 || status === 403) {
                authHalt = true;
                break;
              } else if (status === 429) {
                // M3：写限流不消耗重试预算,直接中止本轮——队列完整保留。
                // 此前 bumpRetries 到阈值后 op 被静默删除(C1 同类问题只是被
                // 推迟),且删除后退避为 0 反而加剧请求密度。服务端已回
                // Retry-After,由下次 flush 触发时机自然重试。
                rateLimited = true;
                break;
              } else {
                // 其余 4xx（400/404/422…）：视为 op 级永久失败（目标不存在/
                // 请求体坏）。保留 bumpRetries 的有界放弃路径,但不再无日志
                // 静默删除：告警后移除,避免坏 op 卡死整个队列。
                console.warn('[offline] dropping op on client error', op.path, op.method, status);
                await remove(op.id);
                hadConflict = true;
              }
            } else {
              // 5xx：服务端瞬时故障,按重试预算退避;达上限后 bumpRetries 移除
              // 并留日志（与 4xx 静默删除区分——5xx 达限说明确实救不回来）。
              console.warn('[offline] server error on op', op.path, op.method, status);
              await bumpRetries(op.id);
              const delayMs = await getRetryDelayForOp(op.id);
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
          } else if (err instanceof TypeError) {
            break;
          } else {
            // 非 ApiException 的未知错误：不再静默 remove（丢数据风险）。
            // 走与 5xx 相同的有界重试路径——最坏 MAX_RETRIES 轮后放弃,且有日志可查。
            console.warn('[offline] unknown error replaying op', op.path, op.method, err);
            await bumpRetries(op.id);
            const delayMs = await getRetryDelayForOp(op.id);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }

      await get().refreshPendingCount();

      // 限流/鉴权中止时不做 loadAll：队列原样保留、无状态需要对账,而此时整体
      // 替换 notesPlain 反而会覆盖编辑器防抖窗口内的未保存输入(F6)。
      // authHalt 同样保留队列:解锁后下一次 flush 自然重放,不丢数据。
      if (rateLimited || authHalt) {
        set({ isOnline: false } as Partial<StoreState>);
        return;
      }

      if (get().pendingConflicts.length === 0 && (hadConflict || ops.length > 0)) {
        try {
          await get().loadAll();
        } catch {
          /* loadAll handles internally */
        }
      }

      if ((await queueSize()) === 0) {
        set({ isOnline: true } as Partial<StoreState>);
      }
    } finally {
      flushingRef.inFlight = false;
    }
  },

  async clearLocalData(): Promise<void> {
    await clearCache();
    await caches.delete('dustnote-runtime-v2');
    // M-A：旧键也要清（v2.5.40 之前旧 SW 写入的 /api/ 明文响应仍在里面）
    await caches.delete('dustnote-runtime').catch(() => undefined);
    const { clear: clearQueue } = await import('../offline-queue');
    await clearQueue();
    clearLocalAuthBlob();
    clearLockoutState();
    clearGraceUnlock();
    set({
      pendingCount: 0,
      pendingConflicts: [],
      localAuthBlob: null,
      lockoutState: INITIAL_LOCKOUT_STATE,
    } as Partial<StoreState>);
  },

  async resolveConflictChoice(
    noteId: string,
    choice: 'local' | 'server' | 'merged'
  ): Promise<void> {
    const conflict = get().pendingConflicts.find((c) => c.noteId === noteId);
    if (!conflict) return;

    const masterKey = get().masterKey;
    if (!masterKey) throw new Error('未解锁');

    const chosen =
      choice === 'local' ? conflict.local : choice === 'server' ? conflict.server : conflict.merged;

    const { json: cipherJson } = await encryptNote(
      masterKey,
      chosen.plaintext,
      noteAad(noteId, get().userId ?? '')
    );

    const body = {
      ciphertext: cipherJson,
      keyVersion: 1,
      isPinned: chosen.isPinned,
      isFavorite: chosen.isFavorite,
      folderId: chosen.folderId,
      deletedAt: chosen.deletedAt,
      clientUpdatedAt: new Date().toISOString(),
      version: conflict.serverVersion,
    };

    const r = await api().patch<{ version: number; serverUpdatedAt: string }>(
      `/notes/${noteId}`,
      body
    );

    const newNotes = new Map(get().notes);
    const existing = newNotes.get(noteId);
    if (existing) {
      newNotes.set(noteId, {
        ...existing,
        ciphertext: cipherJson,
        isPinned: chosen.isPinned,
        isFavorite: chosen.isFavorite,
        folderId: chosen.folderId,
        deletedAt: chosen.deletedAt,
        version: r.version,
        serverUpdatedAt: r.serverUpdatedAt,
      });
      const newPlain = new Map(get().notesPlain);
      newPlain.set(noteId, chosen.plaintext);
      set({ notes: newNotes, notesPlain: newPlain } as Partial<StoreState>);
    }

    set({
      pendingConflicts: get().pendingConflicts.filter((c) => c.noteId !== noteId),
    } as Partial<StoreState>);

    void cacheNotesLocal(get().notes, get().notesPlain, () => get().masterKey).catch(
      () => undefined
    );
  },

  dismissConflict(noteId: string): void {
    set({
      pendingConflicts: get().pendingConflicts.filter((c) => c.noteId !== noteId),
    } as Partial<StoreState>);
  },
});

/**
 * 409 版本冲突处理：三方字段级合并。
 *
 * 当离线重放的 PATCH /notes/:id 返回 409 时，服务端响应体包含 `current`
 * （被其它设备更新后的 NoteRow，含密文）。本函数：
 * 1. 解密服务端 current 得到 server 明文
 * 2. 用 op.conflictCtx 的 base + local + server 调 resolveConflict
 * 3. 无冲突：自动 re-PATCH 合并结果（用 server version）
 * 4. 有冲突：应用 merged 作为暂存态 + 推到 pendingConflicts
 */
async function handleNoteConflict(
  op: import('../offline-queue').QueuedOp,
  err: ApiException
): Promise<void> {
  const ctx = op.conflictCtx;
  if (!ctx) return;

  // 使用 Zustand store 的 getState（延迟引用，避免循环依赖）
  const { useStore } = await import('../store');
  const masterKey = useStore.getState().masterKey;
  if (!masterKey) return;

  const body = err.err.data as { current?: NoteRow } | undefined;
  const serverRow = body?.current;
  if (!serverRow) return;

  let serverPlain: NotePlaintext;
  try {
    const envelope = parseEnvelope(serverRow.ciphertext);
    serverPlain = await decryptNote(
      masterKey,
      envelope,
      noteAad(serverRow.id, useStore.getState().userId ?? '')
    );
  } catch {
    return;
  }

  const serverMeta: NoteMetadata = {
    isPinned: serverRow.isPinned,
    isFavorite: serverRow.isFavorite,
    deletedAt: serverRow.deletedAt,
    folderId: serverRow.folderId,
    clientUpdatedAt: serverRow.clientUpdatedAt,
  };
  const serverMergeable = toMergeable(serverRow.id, serverPlain, serverMeta);

  const result = resolveConflict(ctx.base, ctx.local, serverMergeable);

  const userId = useStore.getState().userId ?? '';
  const { json: mergedCipherJson } = await encryptNote(
    masterKey,
    result.merged.plaintext,
    noteAad(ctx.noteId, userId)
  );

  const prevNotes = useStore.getState().notes;
  const prevPlain = useStore.getState().notesPlain;
  const newNotes = new Map(prevNotes);
  const existing = newNotes.get(ctx.noteId);
  if (existing) {
    newNotes.set(ctx.noteId, {
      ...existing,
      ciphertext: mergedCipherJson,
      isPinned: result.merged.isPinned,
      isFavorite: result.merged.isFavorite,
      folderId: result.merged.folderId,
      deletedAt: result.merged.deletedAt,
      version: serverRow.version,
    });
    const newPlain = new Map(prevPlain);
    newPlain.set(ctx.noteId, result.merged.plaintext);
    useStore.setState({ notes: newNotes, notesPlain: newPlain });
  }

  if (!result.hasConflicts) {
    try {
      const r = await api().patch<{ version: number; serverUpdatedAt: string }>(
        `/notes/${ctx.noteId}`,
        {
          ciphertext: mergedCipherJson,
          keyVersion: 1,
          isPinned: result.merged.isPinned,
          isFavorite: result.merged.isFavorite,
          folderId: result.merged.folderId,
          deletedAt: result.merged.deletedAt,
          clientUpdatedAt: new Date().toISOString(),
          version: serverRow.version,
        }
      );
      const nn = new Map(useStore.getState().notes);
      const updated = nn.get(ctx.noteId);
      if (updated) {
        nn.set(ctx.noteId, {
          ...updated,
          version: r.version,
          serverUpdatedAt: r.serverUpdatedAt,
        });
        useStore.setState({ notes: nn });
      }
    } catch {
      /* re-PATCH failed, loadAll will correct */
    }
  } else {
    const pending: PendingConflict = {
      noteId: ctx.noteId,
      conflicts: result.conflicts,
      merged: result.merged,
      local: ctx.local,
      server: serverMergeable,
      serverVersion: serverRow.version,
    };
    useStore.setState((s) => ({
      pendingConflicts: [
        ...s.pendingConflicts.filter((c: PendingConflict) => c.noteId !== ctx.noteId),
        pending,
      ],
    }));
  }
}
