/**
 * i18n 运行时（框架无关，审计 ARCH-002 后续项）
 *
 * 三端此前各有一套语言处理：web 内联 i18next 配置、mobile 基于 i18next +
 * 语言 store、miniprogram 手写「点号路径取词 + {{插值}} + 回退」运行时。
 * 这里把可共用的部分收敛为单一实现：
 * - 语言常量（支持集、默认语言、storage key）——三端此前各自硬编码，且
 *   web 的 fallback 曾与 mobile 相反（zh-CN 缺 key 时显示英文）
 * - 点号路径取词 + {{name}} 插值 + 「当前语言 → 回退语言 → key 本身」链
 *
 * 平台差异仍留在各端：存储读写（localStorage / AsyncStorage / Taro storage）
 * 与变更通知（i18next 事件 / zustand / Taro.eventCenter）。
 */

/** 支持的语言 */
export type AppLanguage = 'zh-CN' | 'en';

/** 默认语言（产品中文优先） */
export const DEFAULT_LANGUAGE: AppLanguage = 'zh-CN';

/** 回退语言：任意语言缺 key 时最终落到这里 */
export const FALLBACK_LANGUAGE: AppLanguage = DEFAULT_LANGUAGE;

/** 语言偏好的持久化 key（三端统一，历史值不变） */
export const LANGUAGE_STORAGE_KEY = 'dustnote_language';

export const SUPPORTED_LANGUAGES: readonly AppLanguage[] = ['zh-CN', 'en'];

/** 语言值守卫（来自 storage 的任意值 → 合法语言） */
export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'zh-CN' || value === 'en';
}

/** 词典节点：字符串叶子或嵌套对象 */
export type DictNode = { [key: string]: string | DictNode };

/** 词典集合：语言 → 词典 */
export type Dictionaries = Record<AppLanguage, DictNode>;

/**
 * 按点号路径取词典值（如 'settings.theme_light'）。
 * 路径中途遇到非对象或最终不是字符串时返回 undefined。
 */
export function resolveDictKey(dict: DictNode, key: string): string | undefined {
  let cur: string | DictNode | undefined = dict;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object') {
      cur = cur[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

/**
 * {{name}} 插值：缺失参数保留原样（便于发现漏传，而不是渲染成 "undefined"）
 */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? match : String(v);
  });
}

export interface TranslatorOptions {
  dictionaries: Dictionaries;
  /** 读取当前语言（可包含 storage 懒加载逻辑） */
  getLanguage: () => AppLanguage;
  /** 回退语言，默认 zh-CN */
  fallbackLanguage?: AppLanguage;
}

/**
 * 创建翻译函数 t(key, params)：
 * 当前语言词典 → 回退语言词典 → key 本身（返回 key 便于暴露漏译）
 */
export function createTranslator(
  options: TranslatorOptions
): (key: string, params?: Record<string, string | number>) => string {
  const { dictionaries, getLanguage, fallbackLanguage = FALLBACK_LANGUAGE } = options;
  return (key, params) => {
    const current = getLanguage();
    const raw =
      resolveDictKey(dictionaries[current], key) ??
      resolveDictKey(dictionaries[fallbackLanguage], key) ??
      key;
    return interpolate(raw, params);
  };
}
