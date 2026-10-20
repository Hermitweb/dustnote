/**
 * shared/templates.ts 单测 —— 预设模板 + 占位符替换
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PRESET_TEMPLATE_IDS, PRESET_TEMPLATES, fillTemplatePlaceholders } from './templates.js';

const NOW = new Date('2026-10-15T10:00:00.000Z');
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

describe('PRESET_TEMPLATE_IDS', () => {
  it('包含 7 个固定 id（与服务端 seed 一致）', () => {
    expect(PRESET_TEMPLATE_IDS).toEqual([
      'tpl-blank',
      'tpl-journal',
      'tpl-meeting',
      'tpl-todo',
      'tpl-reading',
      'tpl-project',
      'tpl-bookmark',
    ]);
  });
});

describe('PRESET_TEMPLATES', () => {
  it('数量与 ID 列表一致', () => {
    expect(PRESET_TEMPLATES.length).toBe(PRESET_TEMPLATE_IDS.length);
    const ids = PRESET_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual([...PRESET_TEMPLATE_IDS]);
  });

  it('每条模板字段完整', () => {
    for (const t of PRESET_TEMPLATES) {
      expect(t.userId).toBeNull();
      expect(t.isPreset).toBe(true);
      expect(typeof t.name).toBe('string');
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.category).toBe('string');
      expect(typeof t.icon).toBe('string');
      expect(typeof t.sortOrder).toBe('number');
    }
  });
});

describe('fillTemplatePlaceholders', () => {
  it('{{date}} 替换为 YYYY-MM-DD（当日）', () => {
    const out = fillTemplatePlaceholders('# {{date}} 日记');
    expect(out).toBe('# 2026-10-15 日记');
  });

  it('{{url}} / {{title}} 留空', () => {
    // 每个占位符独立被替换为空；中间原样保留一个空格
    expect(fillTemplatePlaceholders('{{title}} {{url}}')).toBe(' ');
    expect(fillTemplatePlaceholders('{{title}}')).toBe('');
    expect(fillTemplatePlaceholders('{{url}}')).toBe('');
  });

  it('未知占位符 → 空字符串（避免 {{xxx}} 残留）', () => {
    const out = fillTemplatePlaceholders('hi {{unknown}} bye');
    expect(out).toBe('hi  bye');
  });

  it('多次出现 {{date}} → 全部替换', () => {
    const out = fillTemplatePlaceholders('{{date}} - {{date}}');
    expect(out).toBe('2026-10-15 - 2026-10-15');
  });

  it('无占位符 → 原样返回', () => {
    expect(fillTemplatePlaceholders('# 纯文本')).toBe('# 纯文本');
  });
});
