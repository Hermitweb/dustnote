/**
 * 轻量 i18n（Taro + React，无第三方依赖）
 *
 * 设计：
 * - 词典来自 src/locales/zh-CN.ts（默认语言，回退用）与 en.ts，namespace 分组的嵌套对象
 * - 语言持久化在 Taro storage（key: dustnote_language），取值 'zh-CN' | 'en'，默认 'zh-CN'
 * - t(key, params?) 按点号路径取词并做 {{name}} 插值；缺失 key 先回退 zh-CN，再回退 key 本身
 * - 语言切换通过 Taro.eventCenter 广播 LANGUAGE_CHANGED_EVENT（事件名常量），
 *   useLanguage() 在 useEffect 中订阅、卸载时 off，语言变化时触发组件重渲染
 */
import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import zhCN from '../locales/zh-CN';
import en from '../locales/en';

/** 支持的语言 */
export type Language = 'zh-CN' | 'en';

/** 语言在 storage 中的 key */
const LANGUAGE_STORAGE_KEY = 'dustnote_language';

/** 语言变化事件名（Taro.eventCenter 广播用常量） */
export const LANGUAGE_CHANGED_EVENT = 'language_changed';

/** 词典节点：字符串叶子或嵌套对象 */
type DictNode = { [key: string]: string | DictNode };

const dictionaries: Record<Language, DictNode> = {
  'zh-CN': zhCN,
  en,
};

let initialized = false;
let currentLanguage: Language = 'zh-CN';

/** 从 storage 读取语言（异常/非法值时回退默认） */
function readLanguage(): Language {
  try {
    const v = Taro.getStorageSync(LANGUAGE_STORAGE_KEY);
    return v === 'en' ? 'en' : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

/** 懒初始化：首次访问时读 storage（避免模块加载期即依赖 Taro API 就绪） */
export function getLanguage(): Language {
  if (!initialized) {
    currentLanguage = readLanguage();
    initialized = true;
  }
  return currentLanguage;
}

/**
 * 切换语言：更新内存态 + 持久化 + eventCenter 通知（订阅的页面重渲染）
 */
export function setLanguage(lang: Language): void {
  if (lang !== 'zh-CN' && lang !== 'en') return;
  currentLanguage = lang;
  initialized = true;
  try {
    Taro.setStorageSync(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // storage 写失败不阻塞切换（仅本次会话生效）
  }
  Taro.eventCenter.trigger(LANGUAGE_CHANGED_EVENT);
}

/** 按点号路径取词典值（如 'settings.theme_light'） */
function resolve(dict: DictNode, key: string): string | undefined {
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
 * 翻译：t('settings.title')；插值：t('index.deleted_count', { count: 3 })
 * 缺失 key 时回退 zh-CN 词典，再回退 key 本身
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const raw =
    resolve(dictionaries[getLanguage()], key) ?? resolve(dictionaries['zh-CN'], key) ?? key;
  if (!params) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? match : String(v);
  });
}

/** 订阅语言变化的 hook：语言切换时触发使用方重渲染 */
export function useLanguage(): Language {
  const [lang, setLang] = useState<Language>(getLanguage());
  useEffect(() => {
    const handler = () => setLang(getLanguage());
    Taro.eventCenter.on(LANGUAGE_CHANGED_EVENT, handler);
    return () => {
      Taro.eventCenter.off(LANGUAGE_CHANGED_EVENT, handler);
    };
  }, []);
  return lang;
}
