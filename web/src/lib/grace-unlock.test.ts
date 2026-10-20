/**
 * grace-unlock 测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getGraceUnlockMin,
  setGraceUnlockMin,
  enableGraceUnlock,
  isGraceUnlockEnabled,
  peekGraceUnlock,
  graceRemainingSec,
  consumeGraceUnlock,
  clearGraceUnlock,
  peekGraceUnlockData,
} from './grace-unlock';

describe('grace-unlock', () => {
  beforeEach(() => {
    localStorage.clear();
    clearGraceUnlock();
  });

  it('getGraceUnlockMin: 无配置 + 非 Tauri → 0', () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    expect(getGraceUnlockMin()).toBe(0);
  });

  it('setGraceUnlockMin: 持久化到 localStorage', () => {
    setGraceUnlockMin(30);
    expect(getGraceUnlockMin()).toBe(30);
    expect(localStorage.getItem('dustnote_grace_unlock_min')).toBe('30');
  });

  it('setGraceUnlockMin: 越界值 clamp 到 [0, 120]', () => {
    setGraceUnlockMin(500);
    expect(getGraceUnlockMin()).toBe(120);
    setGraceUnlockMin(-5);
    expect(getGraceUnlockMin()).toBe(0);
  });

  it('setGraceUnlockMin(0) → 清空缓存', () => {
    enableGraceUnlock(new Uint8Array([1, 2, 3]), null, 5);
    expect(peekGraceUnlock()).toBe(true);
    setGraceUnlockMin(0);
    expect(peekGraceUnlock()).toBe(false);
  });

  it('isGraceUnlockEnabled 随分钟数变化', () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    setGraceUnlockMin(0);
    expect(isGraceUnlockEnabled()).toBe(false);
    setGraceUnlockMin(10);
    expect(isGraceUnlockEnabled()).toBe(true);
  });

  it('enableGraceUnlock + peekGraceUnlock', () => {
    enableGraceUnlock(new Uint8Array([1, 2, 3, 4]), null, 5);
    expect(peekGraceUnlock()).toBe(true);
    expect(graceRemainingSec()).toBeGreaterThan(0);
  });

  it('minutes <= 0 → 不启用且清空', () => {
    enableGraceUnlock(new Uint8Array([1]), null, 0);
    expect(peekGraceUnlock()).toBe(false);
  });

  it('peekGraceUnlockData 取出副本（不消费）', () => {
    enableGraceUnlock(new Uint8Array([1, 2, 3, 4]), null, 5);
    const a = peekGraceUnlockData();
    expect(a).not.toBeNull();
    expect(a?.masterKey.length).toBe(4);
    // 仍可再 peek
    expect(peekGraceUnlock()).toBe(true);
  });

  it('consumeGraceUnlock 单次使用', () => {
    enableGraceUnlock(new Uint8Array([1, 2, 3, 4]), null, 5);
    const a = consumeGraceUnlock();
    expect(a).not.toBeNull();
    // 二次调用 → null
    expect(consumeGraceUnlock()).toBeNull();
  });

  it('clearGraceUnlock → 之后 peek false', () => {
    enableGraceUnlock(new Uint8Array([1, 2, 3, 4]), null, 5);
    clearGraceUnlock();
    expect(peekGraceUnlock()).toBe(false);
  });
});
