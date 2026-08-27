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
    const { mode } = get();
    const repo = createRepository(
      { mode, serverUrl: useModeStore.getState().serverUrl },
      () => get().accessToken
    );
    set({ repository: repo } as Partial<StoreState>);
  },

  async switchMode(target: AppMode, serverUrl: string | null = null): Promise<void> {
    const { repository, masterKey } = get();
    if (!repository || !masterKey) {
      throw new Error('切换模式前需先解锁');
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
