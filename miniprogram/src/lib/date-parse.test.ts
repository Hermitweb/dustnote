/**
 * 服务端时间解析（TEST-004）
 *
 * 这条逻辑存在的唯一理由是一个真机 bug：SQLite 的 `datetime('now')` 产出
 * 「YYYY-MM-DD HH:MM:SS」，iOS/JSC 的 new Date() 对它给 Invalid Date
 * （只认 ISO 的 T 分隔或斜杠写法）。所以这里钉住"空格必须归一化成 T"。
 */
import { describe, it, expect } from 'vitest';
import { parseServerDate } from './date-parse';

describe('parseServerDate', () => {
  it('SQLite 空格分隔串能解析（iOS/JSC 的 Invalid Date 回归）', () => {
    const d = parseServerDate('2026-09-26 10:20:30');
    expect(Number.isNaN(d.getTime())).toBe(false);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(26);
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(20);
  });

  it('ISO 的 T 分隔照旧可解析', () => {
    const d = parseServerDate('2026-09-26T10:20:30Z');
    expect(Number.isNaN(d.getTime())).toBe(false);
  });

  it('Date 与时间戳原样透传（各页面直接替换 new Date(...) 的前提）', () => {
    const now = new Date();
    expect(parseServerDate(now)).toBe(now);
    expect(parseServerDate(1_700_000_000_000).getTime()).toBe(1_700_000_000_000);
  });

  it('空值给 Invalid Date 而不是当前时间——列表会显示成"刚刚"，那比空白更糟', () => {
    for (const v of [null, undefined, '']) {
      expect(Number.isNaN(parseServerDate(v as string | null | undefined).getTime())).toBe(true);
    }
  });

  it('垃圾串给 Invalid Date，不抛异常', () => {
    expect(Number.isNaN(parseServerDate('不是时间').getTime())).toBe(true);
  });
});
