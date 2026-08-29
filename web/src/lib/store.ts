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

// mode-store → 主 store 的 mode 单向同步。
// 主 store 的 mode 只在模块加载时从 mode-store 快照一次，此后 mode-store 的
// 变更（首装选择模式 / ?server= 自动连接 / 设置切换）不会自动反映过来，
// 导致 App 路由按过期的 mode 渲染（v2.5.17 实测：联机首装渲染了
// StandaloneSetupScreen，账号被创建到本地 IndexedDB，服务端 users 仍为 0）。
// 注意：显式切换（switchMode）走自己的迁移+回滚逻辑，订阅只同步 mode 字段，
// 不触碰 repository（由 initRepository / switchMode 各自负责）。
import { useModeStore } from './mode-store';
useModeStore.subscribe((state) => {
  if (useStore.getState().mode !== state.mode) {
    useStore.setState({ mode: state.mode } as Partial<StoreState>);
  }
});

// 启动时同步 i18n 语言
import i18n, { LANGUAGE_STORAGE_KEY } from './i18n';
{
  const _startupLang = useStore.getState().preferences.language;
  if (_startupLang) {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, _startupLang);
    void i18n.changeLanguage(_startupLang);
  }
}
