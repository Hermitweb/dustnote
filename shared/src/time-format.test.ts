/**
 * shared/time-format.ts 单测 —— 笔记时间戳格式（跨端一致）
 *
 * 规则：当天 HH:mm / 本年 M/D / 跨年 YYYY/M/D（与 web Intl 行为一致）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { formatNoteStamp, formatDateTimeStamp } from './time-format.js';

const NOW = new Date('2026-10-15T14:30:00.000Z');

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

describe('formatNoteStamp', () => {
  it('空串 → 空串', () => {
    expect(formatNoteStamp('')).toBe('');
  });

  it('非法 ISO → 空串', () => {
    expect(formatNoteStamp('not-a-date')).toBe('');
  });

  it('同一天 → HH:mm', () => {
    // 本机时区下的今天 09:15
    const todayLocal = new Date();
    todayLocal.setHours(9, 15, 0, 0);
    const out = formatNoteStamp(todayLocal.toISOString());
    // 形如 "09:15"，不依赖时区
    expect(out).toMatch(/^\d{2}:\d{2}$/);
  });

  it('本年不同天 → M/D', () => {
    const d = new Date(NOW);
    d.setMonth(0, 5); // 1/5
    d.setHours(0, 0, 0, 0);
    const out = formatNoteStamp(d.toISOString());
    expect(out).toMatch(/^1\/5$/);
  });

  it('跨年 → YYYY/M/D', () => {
    const d = new Date('2024-03-08T10:00:00.000Z');
    const out = formatNoteStamp(d.toISOString());
    expect(out).toMatch(/^2024\/3\/8$/);
  });
});

describe('formatDateTimeStamp', () => {
  it('空串 / 非法 → 空串', () => {
    expect(formatDateTimeStamp('')).toBe('');
    expect(formatDateTimeStamp('nope')).toBe('');
  });

  it('永远带年份 + HH:mm', () => {
    const out = formatDateTimeStamp('2024-03-08T09:05:00.000Z');
    expect(out).toMatch(/^2024\/3\/8 \d{2}:\d{2}$/);
  });
});
