/**
 * AsyncStorage 内存桩（默认导出与真实包一致）。
 * _store 暴露给测试做直接读写/清空。
 */
const _store = new Map<string, string>();

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return _store.has(key) ? (_store.get(key) as string) : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    _store.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    _store.delete(key);
  },
  async clear(): Promise<void> {
    _store.clear();
  },
  _store,
};

export default AsyncStorage;
