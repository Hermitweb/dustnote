/**
 * 冲突裁决 store（架构改进 #3 的 mobile 端落地）
 *
 * 当离线队列 flush 遇到 409 且字段级合并存在歧义时，offline-queue 的
 * handleConflict 会把冲突推到这里（持久化到 AsyncStorage），由 UI 弹窗让用户裁决。
 *
 * 与 web 语义对齐：
 * - resolveConflictChoice(noteId, choice)：按所选版本（local/server/merged）
 *   以 serverVersion 为乐观锁 re-PATCH，成功后从 pending 移除。
 * - dismissConflict(noteId)：仅从 pending 移除，不联网（与 web 一致：
 *   用户选择暂不处理，本地编辑仍在，下次编辑保存会再次触发冲突）。
 *
 * 注意：mobile 没有 web 那样的中心 notes store，因此冲突检测时**不**自动
 * 把 merged 暂存到本地（web 会）。改为：检测到歧义即推 UI，由用户裁决后
 * 才 re-PATCH 选定版本。无歧义时仍走静默自动合并（见 offline-queue）。
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api';
import { useAuthStore } from './auth';
import { noteAad } from '@dustnote/shared';
import { encryptNote } from '@dustnote/client-core';
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

const CONFLICT_KEY = 'dustnote:pending-conflicts';

async function persist(list: PendingConflict[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CONFLICT_KEY, JSON.stringify(list));
  } catch {
    /* 持久化失败不阻塞内存态 */
  }
}

function setAndPersist(
  set: (partial: Partial<ConflictStoreState>) => void,
  list: PendingConflict[]
): void {
  set({ pendingConflicts: list });
  void persist(list);
}

export const useConflictStore = create<ConflictStoreState>((set, get) => ({
  pendingConflicts: [],

  enqueueConflict: (c) => {
    // 同一笔记只保留最新的 pending
    const next = [...get().pendingConflicts.filter((x) => x.noteId !== c.noteId), c];
    setAndPersist(set, next);
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

    // re-PATCH 选定版本（serverVersion 乐观锁）
    await api.request('PATCH', `/notes/${noteId}`, {
      ciphertext: cipherJson,
      keyVersion: 1,
      isPinned: chosen.isPinned,
      isFavorite: chosen.isFavorite,
      folderId: chosen.folderId,
      deletedAt: chosen.deletedAt,
      clientUpdatedAt: new Date().toISOString(),
      version: conflict.serverVersion,
    });

    // 成功后移除
    setAndPersist(
      set,
      get().pendingConflicts.filter((c) => c.noteId !== noteId)
    );
  },

  dismissConflict: (noteId) => {
    setAndPersist(
      set,
      get().pendingConflicts.filter((c) => c.noteId !== noteId)
    );
  },
}));

// 启动时从 AsyncStorage 恢复未裁决冲突（异步，不阻塞首屏）
void AsyncStorage.getItem(CONFLICT_KEY).then((raw) => {
  if (raw) {
    try {
      const list = JSON.parse(raw) as PendingConflict[];
      if (Array.isArray(list) && list.length > 0) {
        useConflictStore.setState({ pendingConflicts: list });
      }
    } catch {
      /* 损坏数据忽略 */
    }
  }
});
