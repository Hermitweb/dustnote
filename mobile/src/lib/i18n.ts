/**
 * i18n 轻量封装（基于 react-i18next）
 *
 * 与 web 端保持一致的技术栈（i18next + react-i18next），但持久化方式不同：
 * - web：localStorage
 * - mobile：AsyncStorage（RN 异步存储）
 *
 * 语言切换通过 useLanguageStore.setLanguage() 触发，会同时：
 *   1. 调用 i18n.changeLanguage() 切换运行时语言（react-i18next 自动重渲染）
 *   2. 写入 AsyncStorage 持久化
 *
 * 启动时从 AsyncStorage 读取已保存的语言（异步），默认 zh-CN。
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import zhCN from '../locales/zh-CN';
import en from '../locales/en';

export type AppLanguage = 'zh-CN' | 'en';

const LANGUAGE_KEY = 'dustnote_language';

const resources = {
  'zh-CN': { translation: zhCN },
  en: { translation: en },
} as const;

// ========== i18next 初始化 ==========
// 默认 zh-CN；AsyncStorage 读取完成后通过 changeLanguage 切换。
void i18n.use(initReactI18next).init({
  resources,
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
  // 返回 key 本身而非空串，便于发现漏译
  returnNull: false,
});

// 异步加载已保存的语言偏好
AsyncStorage.getItem(LANGUAGE_KEY).then((v) => {
  if (v === 'zh-CN' || v === 'en') {
    if (v !== i18n.language) {
      void i18n.changeLanguage(v);
    }
    useLanguageStore.setState({ language: v });
  }
});

// ========== 语言 store（供 UI 读取/切换当前语言） ==========

interface LanguageStoreState {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
}

export const useLanguageStore = create<LanguageStoreState>((set) => ({
  language: 'zh-CN',
  setLanguage: (language) => {
    AsyncStorage.setItem(LANGUAGE_KEY, language).catch(() => undefined);
    void i18n.changeLanguage(language);
    set({ language });
  },
}));

export default i18n;
