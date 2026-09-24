/**
 * i18n 桩：默认导出 i18next 兼容的 t()（返回 key + 插值参数 JSON），
 * 避免测试环境真的初始化 i18next 语言资源。断言只关心 key 不关心译文。
 */
const i18n = {
  language: 'zh-CN',
  t(key: string, opts?: Record<string, unknown>): string {
    if (opts && Object.keys(opts).length > 0) {
      return `${key}::${JSON.stringify(opts)}`;
    }
    return key;
  },
  isInitialized: true,
  changeLanguage: async () => undefined,
  on: () => undefined,
  off: () => undefined,
};

export default i18n;
