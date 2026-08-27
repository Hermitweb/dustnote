/**
 * Offline Slice — 在线状态、离线队列、冲突解决
 */

import type { StateCreator } from 'zustand';
import {
  ApiException,
} from '@dustnote/shared';
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
import {
  flushingRef,
  replayOp,
  api,
  cacheNotesLocal,
} from '../store-helpers';
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
              await remove(op.id);
              hadConflict = true;
            } else {
              await bumpRetries(op.id);
              const delayMs = await getRetryDelayForOp(op.id);
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
          } else if (err instanceof TypeError) {
            break;
          } else {
            await remove(op.id);
          }
        }
      }

      await get().refreshPendingCount();

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
    await caches.delete('dustnote-runtime');
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

    void cacheNotesLocal(get().notes, get().notesPlain, () => get().masterKey).catch(() => undefined);
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
async function handleNoteConflict(op: import('../offline-queue').QueuedOp, err: ApiException): Promise<void> {
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
      pendingConflicts: [...s.pendingConflicts.filter((c: PendingConflict) => c.noteId !== ctx.noteId), pending],
    }));
  }
}
