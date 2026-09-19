/**
 * 轻量 i18n（Taro + React）
 *
 * 运行时的取词/插值/回退逻辑已下沉到 @dustnote/client-core（审计 ARCH-002
 * 后续项：三端此前各写一套，web/mobile 用 i18next、本端手写）。这里只保留
 * 小程序平台差异：
 * - 词典来自 src/locales/*（本端 UI 专属词条）
 * - 语言持久化在 Taro storage（key: dustnote_language）
 * - 语言切换通过 Taro.eventCenter 广播，useLanguage() 订阅后触发重渲染
 */
import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import {
  type AppLanguage,
  type Dictionaries,
  LANGUAGE_STORAGE_KEY,
  isAppLanguage,
  createTranslator,
  DEFAULT_LANGUAGE,
} from '@dustnote/client-core';
import zhCN from '../locales/zh-CN';
import en from '../locales/en';

export type Language = AppLanguage;

const LANGUAGE_STORAGE_KEY_LOCAL = LANGUAGE_STORAGE_KEY;

/** 语言变化事件名（Taro.eventCenter 广播用常量） */
export const LANGUAGE_CHANGED_EVENT = 'language_changed';

const dictionaries: Dictionaries = {
  'zh-CN': zhCN,
  en,
};

let initialized = false;
let currentLanguage: Language = DEFAULT_LANGUAGE;

/** 从 storage 读取语言（异常/非法值时回退默认） */
function readLanguage(): Language {
  try {
    const v = Taro.getStorageSync(LANGUAGE_STORAGE_KEY_LOCAL);
    return isAppLanguage(v) ? v : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
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
  if (!isAppLanguage(lang)) return;
  currentLanguage = lang;
  initialized = true;
  try {
    Taro.setStorageSync(LANGUAGE_STORAGE_KEY_LOCAL, lang);
  } catch {
    // storage 写失败不阻塞切换（仅本次会话生效）
  }
  Taro.eventCenter.trigger(LANGUAGE_CHANGED_EVENT);
}

/**
 * 翻译：t('settings.title')；插值：t('index.deleted_count', { count: 3 })
 * 缺失 key 回退默认语言词典，再回退 key 本身
 */
export const t = createTranslator({ dictionaries, getLanguage });

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
