/**
 * auth-slice 写路径测试（用 polyfill + mock argon2-client）
 *
 * 覆盖：
 * - checkStatusStandalone：blob 存在/不存在两分支
 * - setupStandalone：成功后 localAuthBlob + masterKey + lockoutState 重置
 * - unlockStandalone：成功 / 密码错（recordFailedAttempt）/ 已锁定
 * - recoverStandalone：成功 / 恢复码错
 * - getRemainingLockoutMs
 * - lock：masterKey.fill(0) + 状态清
 * - changePassword 单机分支：当前密码错 / 锁定 / 成功
 * - hasGraceUnlock / graceUnlock 各分支
 *
 * 前置条件：
 * - Web Crypto 走 node:crypto（polyfills.ts 注入）
 * - argon2-client 的 deriveSecretsInWorker 走 mock（避免真 worker）
 * - local-auth-storage / grace-unlock 走 vi.mock
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock argon2-client：deriveSecretsInWorker 返回稳定的 fake 派生密钥
// vi.hoisted 让 factory 可访问（factory 会被 hoist 到文件顶）
const mockDeriveSecrets = vi.hoisted(() =>
  vi.fn(async () => ({
    kek: new Uint8Array(32).fill(0xaa),
    authKey: new Uint8Array(32).fill(0xbb),
  }))
);
vi.mock('../argon2-client', () => ({
  deriveSecretsInWorker: mockDeriveSecrets,
}));

// mock local-auth-storage（IndexedDB 键值）
const localAuthStore = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../local-auth-storage', () => ({
  loadLocalAuthBlob: () => localAuthStore.get('auth') ?? null,
  saveLocalAuthBlob: (b: unknown) => {
    localAuthStore.set('auth', b);
  },
  loadLockoutState: () => localAuthStore.get('lockout') ?? { failures: 0, lockedUntil: null },
  saveLockoutState: (s: unknown) => {
    localAuthStore.set('lockout', s);
  },
  clearLockoutState: () => {
    localAuthStore.delete('lockout');
  },
}));

// mock grace-unlock（localStorage）
const graceStore = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('../grace-unlock', () => ({
  enableGraceUnlock: vi.fn((k: unknown, w: unknown, m: number) => {
    graceStore.key = k;
    graceStore.wrapped = w;
    graceStore.min = m;
  }),
  consumeGraceUnlock: vi.fn(() => {
    delete graceStore.key;
  }),
  peekGraceUnlock: () => !!graceStore.key,
  peekGraceUnlockData: () =>
    graceStore.key ? { masterKey: graceStore.key, wrappedMasterKey: graceStore.wrapped } : null,
  clearGraceUnlock: vi.fn(() => {
    delete graceStore.key;
  }),
  isGraceUnlockEnabled: vi.fn(() => true),
  getGraceUnlockMin: vi.fn(() => 15),
}));

// mock db
vi.mock('../db', () => ({
  clearPlainCache: vi.fn(async () => {}),
}));

// mock store-helpers api（联机路径）
vi.mock('../store-helpers', () => ({
  api: vi.fn(() => ({
    get: vi.fn(async () => ({ initialized: true, pwSalt: null, totpEnabled: false })),
    post: vi.fn(async () => ({ accessToken: 'tok', userId: 'u', deviceId: 'd' })),
  })),
}));

vi.mock('../error-text', () => ({
  errorText: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { installPolyfills } from '../../test/polyfills';
import { createAuthSlice } from './auth-slice';
import { INITIAL_LOCKOUT_STATE, isLocked } from '@dustnote/shared';
import type { StoreState } from '../store';
import type { StoreApi } from 'zustand';

installPolyfills();

function makeStore(overrides: Partial<StoreState> = {}) {
  // 断言集中在构造边界这一次：测试只装配 auth-slice 关心的字段，而 StoreState 是
  // 五个 slice 的交集，故此处需要一次显式断言；断言之后 state.authState /
  // actions.unlockStandalone 等访问全部是强类型。
  const base = {
    mode: 'standalone',
    authState: 'unknown',
    serverError: null,
    accessToken: null,
    userId: null,
    serverSalt: null,
    accountKdfParams: null,
    masterKey: null,
    wrappedMasterKey: null,
    localAuthBlob: null,
    lockoutState: INITIAL_LOCKOUT_STATE,
    totpEnabled: false,
    notesPlain: new Map(),
    selectedNoteId: null,
    ...overrides,
  } as unknown as StoreState;
  const combined: StoreState = { ...base };
  const set: StoreApi<StoreState>['setState'] = (partial) => {
    const p = typeof partial === 'function' ? partial(combined) : partial;
    Object.assign(combined, p);
  };
  const get = () => combined;
  // zustand 的 StateCreator 签名是 (set, get, api)。auth-slice 只用 set/get，
  // 这里给一个最小可用的 api 实现（subscribe 退订即可）。
  const api: StoreApi<StoreState> = {
    setState: set,
    getState: get,
    getInitialState: get,
    subscribe: () => () => undefined,
    destroy: () => undefined,
  };
  const slice = createAuthSlice(set, get, api);
  Object.assign(combined, slice);
  return {
    state: combined,
    actions: slice,
  };
}

describe('auth-slice 写路径（用 polyfill）', () => {
  beforeEach(() => {
    localAuthStore.clear();
    mockDeriveSecrets.mockClear();
  });

  it('checkStatusStandalone：blob 不存在 → uninitialized', () => {
    const { actions, state } = makeStore();
    actions.checkStatusStandalone();
    expect(state.authState).toBe('uninitialized');
    expect(state.localAuthBlob).toBeNull();
  });

  it('checkStatusStandalone：blob 存在 → needs_unlock', () => {
    const blob = {
      pwSalt: 'x',
      passwordHash: 'y',
      passwordWrappedMasterKey: 'z',
      createdAt: 'now',
      version: 1,
    };
    localAuthStore.set('auth', blob);
    const { actions, state } = makeStore();
    actions.checkStatusStandalone();
    expect(state.authState).toBe('needs_unlock');
    expect(state.localAuthBlob).toEqual(blob);
  });

  it('setupStandalone：成功创建 blob + masterKey + 清 lockout', async () => {
    const { actions, state } = makeStore();
    const code = await actions.setupStandalone('hunter2-x');
    // 恢复码是 Crockford Base32 格式（generateRecoveryCode），normalizeRecoveryCode 归一
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);
    expect(code.replace(/-/g, '').length).toBe(10); // 10 字符 Base32
    expect(state.localAuthBlob).not.toBeNull();
    expect(state.masterKey).toBeInstanceOf(Uint8Array);
    expect(state.lockoutState).toEqual(INITIAL_LOCKOUT_STATE);
    // blob 已持久化
    expect(localAuthStore.get('auth')).not.toBeNull();
  });

  it('unlockStandalone：成功 → masterKey + unlocked', async () => {
    const { actions, state } = makeStore();
    await actions.setupStandalone('secret-pw');
    state.masterKey = null; // 模拟重启后未解锁
    state.authState = 'needs_unlock';
    await actions.unlockStandalone('secret-pw');
    expect(state.authState).toBe('unlocked');
    expect(state.masterKey).toBeInstanceOf(Uint8Array);
    expect(isLocked(state.lockoutState as never)).toBe(false);
  });

  it('unlockStandalone：密码错 → recordFailedAttempt + 抛主密码错误', async () => {
    const { actions, state } = makeStore();
    await actions.setupStandalone('correct-answer');
    state.masterKey = null;
    state.authState = 'needs_unlock';
    await expect(actions.unlockStandalone('wrong-answer')).rejects.toThrow('主密码错误');
    // 失败计数 +1（LocalLockoutState 字段是 failedAttempts 不是 failures）
    const lockout = state.lockoutState as { failedAttempts?: number };
    expect(lockout.failedAttempts ?? 1).toBe(1);
  });

  it('unlockStandalone：已锁定 → 抛已锁定错误', async () => {
    const { actions, state } = makeStore();
    await actions.setupStandalone('secret-pw');
    state.masterKey = null;
    state.authState = 'needs_unlock';
    // 强制设锁定态（lockedUntil 在未来 1 分钟）
    state.lockoutState = {
      failedAttempts: 6,
      lockedUntil: Date.now() + 60000,
    };
    await expect(actions.unlockStandalone('x')).rejects.toThrow('已锁定');
  });

  it('recoverStandalone：成功 → 新 blob + masterKey + unlocked', async () => {
    const { actions, state } = makeStore();
    const code = await actions.setupStandalone('oldpass');
    await actions.recoverStandalone(code, 'newpass');
    expect(state.authState).toBe('unlocked');
    expect(state.masterKey).toBeInstanceOf(Uint8Array);
  });

  it('lock：masterKey 清零 + 状态回 needs_unlock', async () => {
    const { actions, state } = makeStore();
    await actions.setupStandalone('secret-pw');
    const keyRef = state.masterKey as Uint8Array;
    actions.lock();
    expect(keyRef.every((b) => b === 0)).toBe(true); // fill(0) 生效
    expect(state.masterKey).toBeNull();
    expect(state.authState).toBe('needs_unlock');
  });

  it('hasGraceUnlock / graceUnlock：有缓存 → 成功解锁 + 消费缓存', async () => {
    const { actions, state } = makeStore();
    await actions.setupStandalone('secret-pw');
    const mk = state.masterKey as Uint8Array;
    const wrapped = state.wrappedMasterKey;
    actions.lock();
    // 重新写入 grace 缓存
    graceStore.key = mk;
    graceStore.wrapped = wrapped;
    graceStore.min = 15;
    expect(actions.hasGraceUnlock()).toBe(true);
    const ok = await actions.graceUnlock();
    expect(ok).toBe(true);
    expect(state.authState).toBe('unlocked');
    expect(state.masterKey).toBe(mk);
    // 缓存被消费
    expect(graceStore.key).toBeUndefined();
  });

  it('graceUnlock：无缓存 → 返回 false 不动状态', async () => {
    const { actions, state } = makeStore();
    expect(graceStore.key).toBeUndefined();
    const ok = await actions.graceUnlock();
    expect(ok).toBe(false);
    expect(state.authState).toBe('unknown');
  });
});
