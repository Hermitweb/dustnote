/**
 * 模式状态 store（跨端单一实现，审计 ARCH-002 后续项）
 *
 * 单机/联机双模式的状态机此前在 web / mobile / miniprogram 各写一份，且已
 * 分叉（web 会把 serverUrl 同步进 URL 参数并在 resetMode 时打「首访默认已应用」
 * 标记；mobile 走 AsyncStorage 异步 hydrate；miniprogram 走 Taro 同步读写）。
 *
 * 这里收敛为单一实现：状态机与持久化时机统一，平台差异通过依赖注入表达——
 * - storage：同步读 + 写（异步平台由平台侧在起步时先 hydrate，见 hydrate 语义）
 * - onServerUrlChange：web 用于把地址同步到 URL 参数（书签可带地址）
 * - onBeforeReset：web 用于打「首访默认联机已应用」标记（避免重置后又被接管）
 *
 * 返回 zustand vanilla store；各端用 zustand 的 useStore 包成 hook。
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AppMode, ModeState } from '@dustnote/shared';

/** 模式状态的持久化 key（三端统一，历史值不变） */
export const MODE_STORAGE_KEY = 'dustnote_mode_state';

export const DEFAULT_MODE_STATE: ModeState = {
  mode: 'standalone',
  serverUrl: null,
  initialized: false,
};

export interface ModeStoreState extends ModeState {
  /**
   * 持久化状态是否已就绪。同步存储（web / 小程序）恒为 true；
   * 异步存储（安卓 AsyncStorage）起步为 false，hydrate 后置 true。
   */
  hydrated: boolean;
  /** 设置当前模式（不会自动标记为已初始化） */
  setMode: (mode: AppMode) => void;
  /** 设置服务器地址（仅 online 模式有效） */
  setServerUrl: (url: string | null) => void;
  /** 标记模式选择完成（首启用户选完模式后调用） */
  initialize: () => void;
  /** 重置模式状态（注销/切换模式时调用） */
  resetMode: () => void;
  /** 用外部加载到的状态覆盖（异步存储平台的 hydrate 用） */
  applyHydrated: (state: ModeState) => void;
}

export interface ModeStoreDeps {
  /** 同步读取持久化状态（损坏/缺失返回 null） */
  load: () => Partial<ModeState> | null;
  /** 持久化状态（写失败不应抛错） */
  save: (state: ModeState) => void;
  /** serverUrl 变化时回调（web：同步到 URL 参数；其他端可省） */
  onServerUrlChange?: (url: string | null) => void;
  /** resetMode 前置回调（web：打「首访默认已应用」标记） */
  onBeforeReset?: () => void;
  /** 异步存储平台：起步 hydrated=false（默认 true） */
  startsUnhydrated?: boolean;
}

/** 从 store 状态中提取纯 ModeState（剔除 actions / hydrated） */
export function toModeState(s: ModeState): ModeState {
  return { mode: s.mode, serverUrl: s.serverUrl, initialized: s.initialized };
}

export function createModeStore(deps: ModeStoreDeps): StoreApi<ModeStoreState> {
  const { load, save, onServerUrlChange, onBeforeReset, startsUnhydrated = false } = deps;

  const initial: ModeState = { ...DEFAULT_MODE_STATE, ...(load() ?? {}) };

  return createStore<ModeStoreState>((set, get) => ({
    ...initial,
    hydrated: !startsUnhydrated,

    setMode(mode: AppMode): void {
      const next = { ...toModeState(get()), mode };
      save(next);
      set({ mode });
    },

    setServerUrl(url: string | null): void {
      const next = { ...toModeState(get()), serverUrl: url };
      save(next);
      set({ serverUrl: url });
      onServerUrlChange?.(url);
    },

    initialize(): void {
      const next = { ...toModeState(get()), initialized: true };
      save(next);
      set({ initialized: true });
      // 初始化时把已有地址同步出去（web 场景：刷新后 URL 仍带 server 参数）
      if (next.mode === 'online' && next.serverUrl) {
        onServerUrlChange?.(next.serverUrl);
      }
    },

    resetMode(): void {
      // 平台侧前置钩子（web：标记「首访默认联机已应用」——否则 reload 后
      // 又被首访逻辑接管，模式选择界面永远进不去）
      onBeforeReset?.();
      save(DEFAULT_MODE_STATE);
      set({ ...DEFAULT_MODE_STATE, hydrated: true });
    },

    applyHydrated(state: ModeState): void {
      // 只读语义：hydrate 不回写存储（与原异步平台实现一致）。
      // 逐字段兜底：旧版本残留状态可能缺字段或为 undefined
      set({
        mode: state.mode ?? DEFAULT_MODE_STATE.mode,
        serverUrl: state.serverUrl ?? DEFAULT_MODE_STATE.serverUrl,
        initialized: state.initialized ?? DEFAULT_MODE_STATE.initialized,
        hydrated: true,
      });
    },
  }));
}
