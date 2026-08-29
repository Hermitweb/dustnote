/**
 * Mode Slice — 单机/联机模式管理、Repository 注入
 */

import type { StateCreator } from 'zustand';
import type { AppMode, DataRepository } from '@dustnote/shared';
import type { StoreState } from '../store';
import { useModeStore } from '../mode-store';
import { createRepository } from '../repository';
import { clearGraceUnlock } from '../grace-unlock';

export interface ModeSlice {
  mode: AppMode;
  repository: DataRepository | null;
  initRepository: () => void;
  switchMode: (target: AppMode, serverUrl?: string | null) => Promise<void>;
}

export const createModeSlice: StateCreator<StoreState, [], [], ModeSlice> = (set, get) => ({
  mode: useModeStore.getState().mode,
  repository: null,

  initRepository(): void {
    // 以 mode-store 为准：主 store 的 mode 由 store.ts 的订阅同步，
    // 但 initRepository 可能在订阅生效前/后被调用，直接读源头自愈。
    const mode = useModeStore.getState().mode;
    const repo = createRepository(
      { mode, serverUrl: useModeStore.getState().serverUrl },
      () => get().accessToken
    );
    set({ mode, repository: repo } as Partial<StoreState>);
  },

  async switchMode(target: AppMode, serverUrl: string | null = null): Promise<void> {
    const { repository, masterKey, localAuthBlob } = get();
    if (!repository) {
      throw new Error('应用尚未初始化完成，请稍后重试');
    }
    if (!masterKey) {
      // 未解锁：无法导出/迁移数据。仅当源侧没有可迁移数据时允许直接切换
      //（全新安装 / 未创建金库），否则引导用户先解锁。
      const hasMigratableData =
        useModeStore.getState().mode === 'standalone' ? !!localAuthBlob : !!get().accessToken;
      if (hasMigratableData) {
        throw new Error('存在本地数据，请先解锁后再切换模式');
      }
      // 无数据 fresh switch：直接切模式并重建鉴权流（authState 交回 checkStatus 探测）
      clearGraceUnlock();
      useModeStore.getState().setMode(target);
      if (target === 'online') {
        useModeStore.getState().setServerUrl(serverUrl || useModeStore.getState().serverUrl);
      } else {
        useModeStore.getState().setServerUrl(null);
      }
      const newRepo = createRepository(
        { mode: target, serverUrl: useModeStore.getState().serverUrl },
        () => get().accessToken
      );
      set({ mode: target, repository: newRepo, authState: 'unknown' } as Partial<StoreState>);
      await get().checkStatus();
      return;
    }
    clearGraceUnlock();
    const prevMode = useModeStore.getState().mode;
    const prevServerUrl = useModeStore.getState().serverUrl;
    const prevStore = {
      mode: get().mode,
      repository: get().repository,
      notes: get().notes,
      notesPlain: get().notesPlain,
      folders: get().folders,
    };
    try {
      const backup = await repository.exportBackup();
      useModeStore.getState().setMode(target);
      if (serverUrl !== null) {
        useModeStore.getState().setServerUrl(serverUrl);
      }
      const newRepo = createRepository(
        { mode: target, serverUrl: useModeStore.getState().serverUrl },
        () => get().accessToken
      );
      await newRepo.clearBusinessData();
      await newRepo.importBackup(backup);
      set({ mode: target, repository: newRepo } as Partial<StoreState>);
      await get().loadAll();
    } catch (err) {
      useModeStore.getState().setMode(prevMode);
      if (prevServerUrl !== null || serverUrl !== null) {
        useModeStore.getState().setServerUrl(prevServerUrl);
      }
      set({
        mode: prevStore.mode,
        repository: prevStore.repository,
        notes: prevStore.notes,
        notesPlain: prevStore.notesPlain,
        folders: prevStore.folders,
      } as Partial<StoreState>);
      throw err;
    }
  },
});
