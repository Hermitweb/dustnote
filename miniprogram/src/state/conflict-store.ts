/**
 * 冲突裁决 store（架构改进 #3 的 miniprogram 端落地）
 *
 * 与 mobile 端对称：离线队列 flush 遇 409 且字段级合并有歧义时，offline-queue
 * 的 handleConflict 把冲突推到这里（持久化到 Taro storage），由全局组件弹窗裁决。
 *
 * 语义对齐 web：
 * - resolveConflictChoice(noteId, choice)：按所选版本 re-PATCH（serverVersion 乐观锁）
 * - dismissConflict(noteId)：仅移除，不联网
 *
 * miniprogram 无 web 那样的中心 notes store，故冲突检测时不自动暂存 merged，
 * 由 UI 裁决后再 re-PATCH 选定版本（与 mobile 一致）。
 */

import { create } from 'zustand';
import Taro from '@tarojs/taro';
import { getApi, useAuthStore } from './auth';
import { encryptNote } from '@dustnote/client-core';
import { noteAad } from '@dustnote/shared';
import type { FieldConflict, MergeableNote } from '@dustnote/client-core';

export interface PendingConflict {
  noteId: string;
  /** 展示用标题（取本地版本标题） */
  title: string;
  conflicts: FieldConflict[];
  merged: MergeableNote;
  local: MergeableNote;
  server: MergeableNote;
  /** 服务端 current 的版本号，作为 re-PATCH 的乐观锁 */
  serverVersion: number;
}

interface ConflictStoreState {
  pendingConflicts: PendingConflict[];
  enqueueConflict: (c: PendingConflict) => void;
  resolveConflictChoice: (
    noteId: string,
    choice: 'local' | 'server' | 'merged'
  ) => Promise<void>;
  dismissConflict: (noteId: string) => void;
}

const CONFLICT_KEY = 'dustnote:pending-conflicts';

function persist(list: PendingConflict[]): void {
  try {
    Taro.setStorageSync(CONFLICT_KEY, JSON.stringify(list));
  } catch {
    /* 持久化失败不阻塞内存态 */
  }
}

export const useConflictStore = create<ConflictStoreState>((set, get) => ({
  pendingConflicts: [],

  enqueueConflict: (c) => {
    const next = [...get().pendingConflicts.filter((x) => x.noteId !== c.noteId), c];
    set({ pendingConflicts: next });
    persist(next);
  },

  resolveConflictChoice: async (noteId, choice) => {
    const conflict = get().pendingConflicts.find((c) => c.noteId === noteId);
    if (!conflict) return;

    const { masterKey, userId } = useAuthStore.getState();
    if (!masterKey) throw new Error('未解锁');

    const chosen =
      choice === 'local' ? conflict.local : choice === 'server' ? conflict.server : conflict.merged;

    const { json: cipherJson } = await encryptNote(
      masterKey,
      chosen.plaintext,
      noteAad(noteId, userId ?? '')
    );

    await getApi().request('PATCH', `/notes/${noteId}`, {
      ciphertext: cipherJson,
      keyVersion: 1,
      isPinned: chosen.isPinned,
      isFavorite: chosen.isFavorite,
      folderId: chosen.folderId,
      deletedAt: chosen.deletedAt,
      clientUpdatedAt: new Date().toISOString(),
      version: conflict.serverVersion,
    });

    const next = get().pendingConflicts.filter((c) => c.noteId !== noteId);
    set({ pendingConflicts: next });
    persist(next);
  },

  dismissConflict: (noteId) => {
    const next = get().pendingConflicts.filter((c) => c.noteId !== noteId);
    set({ pendingConflicts: next });
    persist(next);
  },
}));

// 启动时从 Taro storage 恢复未裁决冲突
try {
  const raw = Taro.getStorageSync(CONFLICT_KEY) as string | undefined;
  if (raw) {
    const list = JSON.parse(raw) as PendingConflict[];
    if (Array.isArray(list) && list.length > 0) {
      useConflictStore.setState({ pendingConflicts: list });
    }
  }
} catch {
  /* 损坏数据忽略 */
}
