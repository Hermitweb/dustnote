/**
 * 冲突裁决 store（跨端单一实现，审计 ARCH-002 后续项）
 *
 * 原先 mobile 与 miniprogram 各有一份冲突裁决 store，且语义已分叉：
 * **mobile 把 pendingConflicts 持久化到 AsyncStorage——其中 local/server/merged
 * 含解密后的笔记明文**，与 E2EE「明文不落盘」约束冲突（AsyncStorage 未加密）；
 * miniprogram 则刻意只存内存。现统一为单一实现并采用内存态：
 * - 未裁决冲突在应用重启后丢弃：它只是 UI 裁决态，服务端数据不受影响，
 *   用户重新进入页面/再次编辑会重新产生冲突
 * - 绝不把明文写入任何 storage
 *
 * 返回 zustand vanilla store（无 React 依赖）：各端用 zustand 的 useStore
 * 包装成 hook，并在 `getState()` 上做非 React 调用（如离线队列回调）。
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ApiClient } from '@dustnote/shared';
import { noteAad } from '@dustnote/shared';
import { encryptNote } from './envelope.js';
import type { FieldConflict, MergeableNote } from './conflict.js';

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

export type ConflictChoice = 'local' | 'server' | 'merged';

export interface ConflictStoreState {
  pendingConflicts: PendingConflict[];
  enqueueConflict: (c: PendingConflict) => void;
  resolveConflictChoice: (noteId: string, choice: ConflictChoice) => Promise<void>;
  dismissConflict: (noteId: string) => void;
}

export interface ConflictStoreDeps {
  /** 返回最新 ApiClient（需支持 request('PATCH', path, body)） */
  getApi: () => Pick<ApiClient, 'request'>;
  /** 读取当前鉴权材料（masterKey 缺失表示未解锁；userId 参与 AAD） */
  getAuth: () => { masterKey: Uint8Array | null; userId: string | null };
}

/**
 * 创建冲突裁决 store。
 *
 * 语义（与 web 端一致）：
 * - resolveConflictChoice：按所选版本（local/server/merged）以 serverVersion
 *   为乐观锁 re-PATCH，成功后从 pending 移除
 * - dismissConflict：仅从 pending 移除，不联网——本地编辑仍在，下次保存会
 *   再次触发冲突
 */
export function createConflictStore(deps: ConflictStoreDeps): StoreApi<ConflictStoreState> {
  const { getApi, getAuth } = deps;
  return createStore<ConflictStoreState>((set, get) => ({
    pendingConflicts: [],

    enqueueConflict: (c) => {
      // 同一笔记只保留最新的 pending
      set({
        pendingConflicts: [...get().pendingConflicts.filter((x) => x.noteId !== c.noteId), c],
      });
    },

    resolveConflictChoice: async (noteId, choice) => {
      const conflict = get().pendingConflicts.find((c) => c.noteId === noteId);
      if (!conflict) return;

      const { masterKey, userId } = getAuth();
      if (!masterKey) throw new Error('未解锁');

      const chosen =
        choice === 'local'
          ? conflict.local
          : choice === 'server'
            ? conflict.server
            : conflict.merged;

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

      set({ pendingConflicts: get().pendingConflicts.filter((c) => c.noteId !== noteId) });
    },

    dismissConflict: (noteId) => {
      set({ pendingConflicts: get().pendingConflicts.filter((c) => c.noteId !== noteId) });
    },
  }));
}
