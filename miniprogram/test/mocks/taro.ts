/**
 * `@tarojs/taro` 的测试替身
 *
 * 只替平台边界：存储（同步/异步两套）、交互 API（toast/modal/actionSheet）、
 * 事件总线、系统信息。业务逻辑（离线队列、明文缓存、搜索索引、主题持久化）跑真身。
 * 存储用 Map 模拟，`resetStorage(seed)` 可在用例里预置/清空。
 */
/**
 * 存储挂在 globalThis 上，而不是模块级 const。
 * 原因：用例里会 vi.resetModules() 重新导入被测模块（队列是模块级单例，
 * 不重置就测不到冷启动行为），而那会连这份 mock 一起重建 ——
 * 若 store 是模块级的，重置模块等于清空存储，"重启后队列还在"这类断言就永远测不到。
 */
const G = globalThis as unknown as { __taroStore?: Map<string, unknown> };
const store = G.__taroStore ?? new Map<string, unknown>();
G.__taroStore = store;

export const getStorageSync = (key: string): unknown => (store.has(key) ? store.get(key) : '');
export const setStorageSync = (key: string, value: unknown): void => {
  store.set(key, value);
};
export const removeStorageSync = (key: string): void => {
  store.delete(key);
};
export const getStorage = async (opts: { key: string }): Promise<{ data: unknown }> => ({
  data: store.get(opts.key),
});
export const setStorage = async (opts: { key: string; data: unknown }): Promise<void> => {
  store.set(opts.key, opts.data);
};

export const showToast = (opts: { title?: string }): { title?: string } => opts;
export const showLoading = (): void => undefined;
export const hideLoading = (): void => undefined;
export const showModal = async (): Promise<{ confirm: boolean; cancel: boolean }> => ({
  confirm: true,
  cancel: false,
});
export const showActionSheet = async (): Promise<{ tapIndex: number }> => ({ tapIndex: 0 });
export const setNavigationBarTitle = async (): Promise<void> => undefined;
export const getSystemInfoSync = (): { theme: string } => ({ theme: 'light' });
export const getAppBaseInfo = (): { theme: string } => ({ theme: 'light' });
export const request = async (): Promise<{ statusCode: number; data: unknown }> => ({
  statusCode: 200,
  data: {},
});

/** 事件总线：flush 成功后广播 data-changed，记录触发即可断言 */
const GF = globalThis as unknown as { __taroFired?: Array<{ event: string; payload: unknown }> };
export const fired: Array<{ event: string; payload: unknown }> = GF.__taroFired ?? [];
GF.__taroFired = fired;
export const eventCenter = {
  trigger: (event: string, payload?: unknown): void => {
    fired.push({ event, payload });
  },
  on: (): void => undefined,
  off: (): void => undefined,
};

export function resetStorage(seed?: Record<string, unknown>): void {
  store.clear();
  fired.length = 0;
  if (seed) for (const [k, v] of Object.entries(seed)) store.set(k, v);
}
export function dumpStorage(): Record<string, unknown> {
  return Object.fromEntries(store);
}

export default {
  getStorageSync,
  setStorageSync,
  removeStorageSync,
  getStorage,
  setStorage,
  showToast,
  showLoading,
  hideLoading,
  showModal,
  showActionSheet,
  setNavigationBarTitle,
  getSystemInfoSync,
  getAppBaseInfo,
  request,
  eventCenter,
};
