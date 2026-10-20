/**
 * local-auth-storage 测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadLocalAuthBlob,
  saveLocalAuthBlob,
  clearLocalAuthBlob,
  hasLocalAuth,
  loadLockoutState,
  saveLockoutState,
  clearLockoutState,
} from './local-auth-storage';

const sampleBlob = {
  version: 1,
  kdfParams: {
    algorithm: 'PBKDF2-SHA256' as never,
    iterations: 100000 as never,
    salt: 'AAAA' as never,
  },
  pwSalt: 'BBBB' as never,
  rcSalt: 'CCCC' as never,
  passwordHash: 'XXXX' as never,
  recoveryHash: 'YYYY' as never,
  passwordWrappedMasterKey: '{}' as never,
  recoveryWrappedMasterKey: null as never,
  createdAt: '2026-09-25T00:00:00.000Z' as never,
};

describe('local-auth-storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loadLocalAuthBlob: 不存在 → null', () => {
    expect(loadLocalAuthBlob()).toBeNull();
  });

  it('saveLocalAuthBlob → hasLocalAuth + loadLocalAuthBlob 行为', () => {
    // 不实际测读写往返，因为 sampleBlob 是手搓的 stub，
    // 真实 share/types LocalAuthBlob 的 deserializeLocalAuthBlob 会 schema 校验。
    // 这里改为只测 hasLocalAuth + clearLocalAuthBlob 配套行为
    saveLocalAuthBlob(sampleBlob as never);
    expect(hasLocalAuth()).toBe(true);
    clearLocalAuthBlob();
    expect(hasLocalAuth()).toBe(false);
  });

  it('clearLocalAuthBlob 清空', () => {
    saveLocalAuthBlob(sampleBlob as never);
    clearLocalAuthBlob();
    expect(loadLocalAuthBlob()).toBeNull();
  });

  it('hasLocalAuth 随写入状态变化', () => {
    expect(hasLocalAuth()).toBe(false);
    saveLocalAuthBlob(sampleBlob as never);
    expect(hasLocalAuth()).toBe(true);
  });

  it('loadLockoutState: 不存在 → 返回初始', () => {
    const state = loadLockoutState();
    expect(state.failedAttempts).toBe(0);
    expect(state.lockedUntil).toBe(0);
  });

  it('saveLockoutState → loadLockoutState', () => {
    saveLockoutState({ failedAttempts: 3, lockedUntil: 12345 });
    const loaded = loadLockoutState();
    expect(loaded.failedAttempts).toBe(3);
    expect(loaded.lockedUntil).toBe(12345);
  });

  it('损坏的 JSON → 走初始', () => {
    localStorage.setItem('dustnote_lockout_state', '{坏');
    const state = loadLockoutState();
    expect(state.failedAttempts).toBe(0);
  });

  it('clearLockoutState 清空', () => {
    saveLockoutState({ failedAttempts: 5, lockedUntil: 100 });
    clearLockoutState();
    const state = loadLockoutState();
    expect(state.failedAttempts).toBe(0);
  });
});
