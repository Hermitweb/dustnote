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
  resolveConflictChoice: (noteId: string, choice: 'local' | 'server' | 'merged') => Promise<void>;
  dismissConflict: (noteId: string) => void;
}

// 冲突的 local/server/merged 含笔记明文——只存内存,绝不落盘(E2EE 模型:
// 明文不得进入可导出/备份的 storage)。未裁决冲突在应用重启后丢弃,
// 服务端数据不受影响(冲突只是 UI 裁决态,重进页面会重新产生)。

export const useConflictStore = create<ConflictStoreState>((set, get) => ({
  pendingConflicts: [],

  enqueueConflict: (c) => {
    const next = [...get().pendingConflicts.filter((x) => x.noteId !== c.noteId), c];
    set({ pendingConflicts: next });
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
  },

  dismissConflict: (noteId) => {
    const next = get().pendingConflicts.filter((c) => c.noteId !== noteId);
    set({ pendingConflicts: next });
  },
}));


