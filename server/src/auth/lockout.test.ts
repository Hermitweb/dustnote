/**
 * 账号锁定逻辑单元测试
 *
 * lockout.ts 是纯函数，不依赖 DB，直接测试状态转换。
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_FAILED_ATTEMPTS,
  LOCK_DURATION_MS,
  CLEAN_STATE,
  isLocked,
  remainingLockMs,
  recordFailure,
  recordSuccess,
  type LockoutState,
} from './lockout.js';

describe('lockout', () => {
  describe('CLEAN_STATE', () => {
    it('starts with zero attempts and no lock', () => {
      expect(CLEAN_STATE.failedAttempts).toBe(0);
      expect(CLEAN_STATE.lockedUntil).toBeNull();
    });
  });

  describe('isLocked', () => {
    it('returns false for clean state', () => {
      expect(isLocked(CLEAN_STATE)).toBe(false);
    });

    it('returns false when lockedUntil is in the past', () => {
      const past = new Date(Date.now() - 1000).toISOString();
      expect(isLocked({ failedAttempts: 6, lockedUntil: past })).toBe(false);
    });

    it('returns true when lockedUntil is in the future', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      expect(isLocked({ failedAttempts: 6, lockedUntil: future })).toBe(true);
    });

    it('returns false when lockedUntil is null even with high attempt count', () => {
      // 达到阈值前 lockedUntil 仍是 null
      expect(isLocked({ failedAttempts: 5, lockedUntil: null })).toBe(false);
    });
  });

  describe('remainingLockMs', () => {
    it('returns 0 when not locked', () => {
      expect(remainingLockMs(CLEAN_STATE)).toBe(0);
    });

    it('returns positive ms when locked', () => {
      const future = new Date(Date.now() + 30_000).toISOString();
      const remain = remainingLockMs({ failedAttempts: 6, lockedUntil: future });
      expect(remain).toBeGreaterThan(25_000);
      expect(remain).toBeLessThanOrEqual(30_000);
    });

    it('returns 0 when lock has expired', () => {
      const past = new Date(Date.now() - 1000).toISOString();
      expect(remainingLockMs({ failedAttempts: 6, lockedUntil: past })).toBe(0);
    });
  });

  describe('recordFailure', () => {
    it('increments attempts without locking before threshold', () => {
      const next = recordFailure(CLEAN_STATE);
      expect(next.failedAttempts).toBe(1);
      expect(next.lockedUntil).toBeNull();
    });

    it('accumulates attempts across multiple failures', () => {
      let state: LockoutState = CLEAN_STATE;
      for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
        state = recordFailure(state);
        expect(state.failedAttempts).toBe(i);
        expect(state.lockedUntil).toBeNull();
      }
    });

    it('locks when reaching MAX_FAILED_ATTEMPTS', () => {
      // 预置 5 次失败（阈值 6，再失败一次触发锁定）
      const state: LockoutState = { failedAttempts: MAX_FAILED_ATTEMPTS - 1, lockedUntil: null };
      const next = recordFailure(state);
      expect(next.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
      expect(next.lockedUntil).not.toBeNull();
      // lockedUntil 应在 now + LOCK_DURATION_MS 附近（允许 1s 漂移）
      const lockMs = new Date(next.lockedUntil!).getTime() - Date.now();
      expect(lockMs).toBeGreaterThan(LOCK_DURATION_MS - 1000);
      expect(lockMs).toBeLessThan(LOCK_DURATION_MS + 1000);
    });

    it('locks exactly at 6 failures total', () => {
      let state: LockoutState = CLEAN_STATE;
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        state = recordFailure(state);
      }
      expect(state.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
      expect(state.lockedUntil).not.toBeNull();
    });

    it('refreshes lock window on failure while already locked', () => {
      // 已锁定状态下再失败：lockedUntil 被刷新到新的 now + LOCK_DURATION_MS
      const alreadyLocked: LockoutState = {
        failedAttempts: MAX_FAILED_ATTEMPTS,
        lockedUntil: new Date('2026-01-01T00:00:00Z').toISOString(),
      };
      const newNow = new Date('2026-02-01T00:00:00Z');
      const next = recordFailure(alreadyLocked, newNow);
      expect(next.failedAttempts).toBe(MAX_FAILED_ATTEMPTS + 1);
      const expected = new Date(newNow.getTime() + LOCK_DURATION_MS).toISOString();
      expect(next.lockedUntil).toBe(expected);
    });

    it('uses injected now for deterministic lockUntil', () => {
      const fixedNow = new Date('2026-01-01T00:00:00Z');
      const state: LockoutState = { failedAttempts: MAX_FAILED_ATTEMPTS - 1, lockedUntil: null };
      const next = recordFailure(state, fixedNow);
      const expected = new Date(fixedNow.getTime() + LOCK_DURATION_MS).toISOString();
      expect(next.lockedUntil).toBe(expected);
    });
  });

  describe('recordSuccess', () => {
    it('resets to clean state (returns fresh CLEAN_STATE regardless of input)', () => {
      // recordSuccess 不读输入，固定返回 clean state
      const next = recordSuccess();
      expect(next.failedAttempts).toBe(0);
      expect(next.lockedUntil).toBeNull();
      // 确保返回新对象，不引用 CLEAN_STATE
      expect(next).not.toBe(CLEAN_STATE);
      expect(next).toEqual(CLEAN_STATE);
    });
  });

  describe('lockout lifecycle (integration of pure functions)', () => {
    it('full cycle: 5 failures → no lock, 6th → locked, success → clean', () => {
      let state = CLEAN_STATE;

      // 前 5 次失败不锁定
      for (let i = 0; i < 5; i++) {
        state = recordFailure(state);
        expect(isLocked(state)).toBe(false);
      }
      expect(state.failedAttempts).toBe(5);

      // 第 6 次锁定
      state = recordFailure(state);
      expect(isLocked(state)).toBe(true);
      expect(remainingLockMs(state)).toBeGreaterThan(0);

      // 登录成功后清零
      state = recordSuccess();
      expect(isLocked(state)).toBe(false);
      expect(state.failedAttempts).toBe(0);
    });
  });
});
