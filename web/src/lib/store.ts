/**
 * 全局状态：masterKey、auth、notes、folders、tags、theme、i18n、preferences
 *
 * v2.0.0 支持 单机/联机 双模式：
 * - standalone：数据存储在 IndexedDB（LocalRepository），鉴权走 local-auth.ts
 * - online：数据存储在服务端（RemoteRepository），鉴权走 /auth/* API
 *
 * masterKey 仅存内存（refresh 后清空），刷新页面需重新解锁
 *
 * v2.5.13：拆分为 Zustand slices（auth/mode/data/prefs/offline），
 * 每个 slice 职责单一，通过 get() 跨 slice 读取状态。
 */

import { create } from 'zustand';

// 类型导出（消费者从 ./store-types 导入，此处再导出保持兼容）
export type {
  NoteRow,
  NotePlaintext,
  Folder,
  AuthState,
  ViewMode,
  ThemeId,
  Mode,
  Preferences,
  PendingConflict,
  NoteCipherEnvelope,
} from './store-types';

// Slice 类型
import type { AuthSlice } from './slices/auth-slice';
import type { ModeSlice } from './slices/mode-slice';
import type { DataSlice } from './slices/data-slice';
import type { PrefsSlice } from './slices/prefs-slice';
import type { OfflineSlice } from './slices/offline-slice';

// Slice 实现
import { createAuthSlice } from './slices/auth-slice';
import { createModeSlice } from './slices/mode-slice';
import { createDataSlice } from './slices/data-slice';
import { createPrefsSlice } from './slices/prefs-slice';
import { createOfflineSlice } from './slices/offline-slice';

// 工具函数
import { setAccessTokenGetter } from './store-helpers';

export type StoreState = AuthSlice & ModeSlice & DataSlice & PrefsSlice & OfflineSlice;

export const useStore = create<StoreState>()((...args) => ({
  ...createAuthSlice(...args),
  ...createModeSlice(...args),
  ...createDataSlice(...args),
  ...createPrefsSlice(...args),
  ...createOfflineSlice(...args),
}));

// 注册 accessToken getter（打破 store-helpers ↔ store 循环依赖）
setAccessTokenGetter(() => useStore.getState().accessToken);

// 启动时同步 i18n 语言
import i18n, { LANGUAGE_STORAGE_KEY } from './i18n';
{
  const _startupLang = useStore.getState().preferences.language;
  if (_startupLang) {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, _startupLang);
    void i18n.changeLanguage(_startupLang);
  }
}
