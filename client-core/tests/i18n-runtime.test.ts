/**
 * i18n 运行时测试（审计 ARCH-002 后续项）
 *
 * 锁住三端统一后的取词/插值/回退契约——此前小程序手写一套、web/mobile 各配
 * 一份 i18next，回退语言还曾相反（web 回退 en，mobile 回退 zh-CN）。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  FALLBACK_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  createTranslator,
  interpolate,
  isAppLanguage,
  resolveDictKey,
  type Dictionaries,
} from '../src/i18n-runtime.js';

const dictionaries: Dictionaries = {
  'zh-CN': {
    common: { save: '保存', count: '共 {{count}} 条' },
    onlyZh: '仅中文',
  },
  en: {
    common: { save: 'Save', count: '{{count}} items' },
    onlyEn: 'English only',
  },
};

describe('语言常量', () => {
  it('默认中文、回退默认语言、支持集与存储 key 稳定', () => {
    expect(DEFAULT_LANGUAGE).toBe('zh-CN');
    expect(FALLBACK_LANGUAGE).toBe(DEFAULT_LANGUAGE);
    expect(SUPPORTED_LANGUAGES).toEqual(['zh-CN', 'en']);
    expect(LANGUAGE_STORAGE_KEY).toBe('dustnote_language');
  });

  it('isAppLanguage 只认受支持值', () => {
    expect(isAppLanguage('zh-CN')).toBe(true);
    expect(isAppLanguage('en')).toBe(true);
    expect(isAppLanguage('ja')).toBe(false);
    expect(isAppLanguage(null)).toBe(false);
    expect(isAppLanguage(undefined)).toBe(false);
  });
});

describe('resolveDictKey', () => {
  it('按点号路径取叶子字符串', () => {
    expect(resolveDictKey(dictionaries['zh-CN'], 'common.save')).toBe('保存');
  });

  it('路径中途非对象 / 叶子非字符串 → undefined', () => {
    expect(resolveDictKey(dictionaries['zh-CN'], 'common.save.x')).toBeUndefined();
    expect(resolveDictKey(dictionaries['zh-CN'], 'common')).toBeUndefined();
    expect(resolveDictKey(dictionaries['zh-CN'], 'nope.nope')).toBeUndefined();
  });
});

describe('interpolate', () => {
  it('替换 {{name}}；缺参保留原样（暴露漏传而非渲染 undefined）', () => {
    expect(interpolate('共 {{count}} 条', { count: 3 })).toBe('共 3 条');
    expect(interpolate('共 {{count}} 条')).toBe('共 {{count}} 条');
    expect(interpolate('{{a}}-{{b}}', { a: 'x' })).toBe('x-{{b}}');
    expect(interpolate('{{a}}', { a: 0 })).toBe('0');
  });
});

describe('createTranslator', () => {
  it('取当前语言词条并插值', () => {
    const t = createTranslator({ dictionaries, getLanguage: () => 'en' });
    expect(t('common.save')).toBe('Save');
    expect(t('common.count', { count: 2 })).toBe('2 items');
  });

  it('当前语言缺 key → 回退默认语言（而非英文）', () => {
    const t = createTranslator({ dictionaries, getLanguage: () => 'en' });
    expect(t('onlyZh')).toBe('仅中文');
  });

  it('两语言都缺 → 返回 key 本身', () => {
    const t = createTranslator({ dictionaries, getLanguage: () => 'zh-CN' });
    expect(t('missing.key')).toBe('missing.key');
  });

  it('getLanguage 每次调用都重新读取（支持运行时切换）', () => {
    let lang: 'zh-CN' | 'en' = 'zh-CN';
    const t = createTranslator({ dictionaries, getLanguage: () => lang });
    expect(t('common.save')).toBe('保存');
    lang = 'en';
    expect(t('common.save')).toBe('Save');
  });

  it('可覆盖回退语言', () => {
    const t = createTranslator({
      dictionaries,
      getLanguage: () => 'zh-CN',
      fallbackLanguage: 'en',
    });
    expect(t('onlyEn')).toBe('English only');
  });
});
