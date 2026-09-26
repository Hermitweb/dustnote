/**
 * `@dustnote/web/i18n` 的测试替身：真实 i18next 初始化在单测里是噪音
 * （与 mobile/test/mocks/i18n.ts 同一决定）
 */
export const t = (key: string, args?: Record<string, unknown>): string =>
  args ? `${key}:${JSON.stringify(args)}` : key;
export default { t, language: 'zh-CN', changeLanguage: async () => undefined };
