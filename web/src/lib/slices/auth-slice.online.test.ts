/**
 * web/src/lib/slices/auth-slice.ts 单测 —— 联机模式简单路径
 *
 * 联机模式的 setup/unlock/recover 涉及真实 fetch + Web Crypto + zustand store
 * 完整状态机，由 auth-slice.write.test.ts 已经在 standalone 路径覆盖。
 * 这里补全联机模式剩余的几个小分支：getRemainingLockoutMs、online graceUnlock、
 * lock 清 masterKey 的 fill(0)、hasGraceUnlock peek。
 *
 * 复用 polyfill + mock 模式。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDeriveSecrets = vi.hoisted(() =>
  vi.fn(async () => ({
    kek: new Uint8Array(32).fill(0xaa),
    authKey: new Uint8Array(32).fill(0xbb),
  }))
);
vi.mock('../argon2-client', () => ({
  deriveSecretsInWorker: mockDeriveSecrets,
}));

const localAuthStore = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../local-auth-storage', () => ({
  loadLocalAuthBlob: () => localAuthStore.get('auth') ?? null,
  saveLocalAuthBlob: (b: unknown) => localAuthStore.set('auth', b),
  loadLockoutState: () => localAuthStore.get('lockout') ?? { failedAttempts: 0, lockedUntil: null },
  saveLockoutState: (s: unknown) => localAuthStore.set('lockout', s),
  clearLockoutState: () => localAuthStore.delete('lockout'),
}));

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

vi.mock('../db', () => ({ clearPlainCache: vi.fn(async () => {}) }));

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('../store-helpers', () => ({
  api: () => ({ get: apiGet, post: apiPost }),
}));

vi.mock('../error-text', () => ({
  errorText: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

// @dustnote/shared 走真实实现（unlockLocalAuth 需 IndexedDB + Web Crypto）

import { installPolyfills } from '../../test/polyfills';
import { createAuthSlice } from './auth-slice';
import { INITIAL_LOCKOUT_STATE, toBase64 } from '@dustnote/shared';
import type { StoreState } from '../store';
import type { StoreApi } from 'zustand';

installPolyfills();

function makeStore(overrides: Partial<StoreState> = {}) {
  // 断言集中在构造边界这一次：测试只装配 auth-slice 关心的字段，而 StoreState 是
  // 五个 slice 的交集，故此处需要一次显式断言；断言之后 state.authState /
  // actions.graceUnlock 等访问全部是强类型。
  const base = {
    mode: 'online',
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
  // 先把 slice 的初始值/方法挂到 combined
  Object.assign(combined, slice);
  // 再用 overrides 覆盖（让测试能注入 lockoutState 等 state 字段）
  Object.assign(combined, overrides);
  return { state: combined, actions: slice };
}

describe('auth-slice 联机模式简单路径', () => {
  beforeEach(() => {
    localAuthStore.clear();
    delete graceStore.key;
    delete graceStore.wrapped;
    delete graceStore.min;
    apiGet.mockReset();
    apiPost.mockReset();
    mockDeriveSecrets.mockClear();
  });

  describe('getRemainingLockoutMs', () => {
    it('未锁定 → 0', () => {
      const { actions } = makeStore({
        // lockedUntil=0 是 LocalLockoutState 里「未锁定」的规范取值
        lockoutState: { failedAttempts: 2, lockedUntil: 0 },
      });
      expect(actions.getRemainingLockoutMs()).toBe(0);
    });

    it('lockedUntil 在未来 → remainingLockoutMs 返回正数', () => {
      const future = Date.now() + 300_000; // 5min
      const { actions } = makeStore({
        lockoutState: { failedAttempts: 6, lockedUntil: future },
      });
      const ms = actions.getRemainingLockoutMs();
      expect(ms).toBeGreaterThan(290_000);
      expect(ms).toBeLessThanOrEqual(300_000);
    });

    it('lockedUntil 在过去 → 0（已过期自动放行）', () => {
      const past = Date.now() - 1000;
      const { actions } = makeStore({
        lockoutState: { failedAttempts: 6, lockedUntil: past },
      });
      expect(actions.getRemainingLockoutMs()).toBe(0);
    });
  });

  describe('online graceUnlock', () => {
    it('有缓存 + /auth/refresh 成功 → 还原 masterKey + unlocked', async () => {
      const fakeKey = new Uint8Array(32).fill(0x77);
      const fakeWrapped = { v: 1, k: 1, n: 'a', c: 'b' };
      graceStore.key = fakeKey;
      graceStore.wrapped = fakeWrapped;
      apiPost.mockResolvedValueOnce({ accessToken: 'new-tok' });

      const { actions, state } = makeStore();
      const ok = await actions.graceUnlock();
      expect(ok).toBe(true);
      expect(apiPost).toHaveBeenCalledWith('/auth/refresh');
      expect(state.accessToken).toBe('new-tok');
      expect(state.masterKey).toBe(fakeKey);
      expect(state.wrappedMasterKey).toBe(fakeWrapped);
      expect(state.authState).toBe('unlocked');
      // 缓存被消费
      expect(graceStore.key).toBeUndefined();
    });

    it('有缓存 + /auth/refresh 失败 → 不消费缓存，返回 false（保留重试机会）', async () => {
      graceStore.key = new Uint8Array(32);
      apiPost.mockRejectedValueOnce(new Error('network'));

      const { actions, state } = makeStore();
      const ok = await actions.graceUnlock();
      expect(ok).toBe(false);
      // 关键：缓存**未**被消费（保留重试）
      expect(graceStore.key).not.toBeUndefined();
      // 状态未变更
      expect(state.authState).toBe('unknown');
    });

    it('无缓存 → 直接返回 false（不调 /auth/refresh）', async () => {
      const { actions } = makeStore();
      const ok = await actions.graceUnlock();
      expect(ok).toBe(false);
      expect(apiPost).not.toHaveBeenCalled();
    });
  });

  describe('lock 行为细节', () => {
    it('lock 时无 masterKey → 不 fill(0)，不报错', () => {
      const { actions, state } = makeStore();
      expect(() => actions.lock()).not.toThrow();
      expect(state.authState).toBe('needs_unlock');
      expect(state.selectedNoteId).toBeNull();
    });

    it('lock 清空 accessToken / selectedNoteId / notesPlain', async () => {
      const { actions, state } = makeStore({
        accessToken: 'tok',
        selectedNoteId: 'note-1',
        notesPlain: new Map([['n1', { title: 't', content: 'c', tags: [] }]]),
      });
      actions.lock();
      expect(state.accessToken).toBeNull();
      expect(state.selectedNoteId).toBeNull();
      expect(state.notesPlain.size).toBe(0);
    });
  });

  describe('hasGraceUnlock', () => {
    it('有缓存 → true', () => {
      graceStore.key = new Uint8Array(32);
      const { actions } = makeStore();
      expect(actions.hasGraceUnlock()).toBe(true);
    });

    it('无缓存 → false', () => {
      const { actions } = makeStore();
      expect(actions.hasGraceUnlock()).toBe(false);
    });
  });

  describe('online checkStatus', () => {
    it('未初始化 → authState=uninitialized + 清空 salt/totp/kdfParams', async () => {
      apiGet.mockResolvedValueOnce({ initialized: false, pwSalt: null, totpEnabled: false });
      const { actions, state } = makeStore({
        serverSalt: 'old',
        accountKdfParams: { algorithm: 'pbkdf2', m: 0, t: 0, p: 0, iterations: 1, dkLen: 1 },
        totpEnabled: true,
        serverError: 'old',
      });
      await actions.checkStatus();
      expect(apiGet).toHaveBeenCalledWith('/auth/status');
      expect(state.authState).toBe('uninitialized');
      expect(state.serverSalt).toBeNull();
      expect(state.totpEnabled).toBe(false);
      expect(state.accountKdfParams).toBeNull();
      expect(state.serverError).toBeNull();
    });

    it('已初始化 → authState=needs_unlock + 写 salt/totp/kdfParams', async () => {
      const kdf = { algorithm: 'pbkdf2' as const, m: 0, t: 0, p: 0, iterations: 100000, dkLen: 32 };
      apiGet.mockResolvedValueOnce({
        initialized: true,
        pwSalt: 'AAAA',
        totpEnabled: true,
        kdfParams: kdf,
      });
      const { actions, state } = makeStore();
      await actions.checkStatus();
      expect(state.authState).toBe('needs_unlock');
      expect(state.serverSalt).toBe('AAAA');
      expect(state.totpEnabled).toBe(true);
      expect(state.accountKdfParams).toEqual(kdf);
    });

    it('network 错误 → authState=error + serverError 走 errorText', async () => {
      apiGet.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const { actions, state } = makeStore();
      await actions.checkStatus();
      expect(state.authState).toBe('error');
      expect(state.serverError).toBeTruthy();
      // errorText 应当给出非英文/有意义字符串
      expect(typeof state.serverError).toBe('string');
    });
  });

  describe('online setup', () => {
    it('成功：masterKey + accessToken + serverSalt + wrappedMasterKey 写入', async () => {
      apiPost.mockResolvedValueOnce({
        accessToken: 'tok-setup',
        userId: 'u-setup',
        deviceId: 'd-1',
      });
      const { actions, state } = makeStore();
      const code = await actions.setup('TestPass123');
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
      expect(apiPost).toHaveBeenCalledWith(
        '/auth/setup',
        expect.objectContaining({
          deviceName: 'Web 浏览器',
        })
      );
      expect(state.accessToken).toBe('tok-setup');
      expect(state.userId).toBe('u-setup');
      expect(state.masterKey).toBeInstanceOf(Uint8Array);
      expect(state.serverSalt).toBeTruthy();
      expect(state.wrappedMasterKey).toBeTruthy();
    });
  });

  describe('online unlock', () => {
    it('成功：用 server status 拿 salt + KDF + 拿到 wrappedMasterKey', async () => {
      // 第一次：/auth/status（取 salt），第二次：/auth/unlock
      apiGet.mockResolvedValueOnce({
        initialized: true,
        pwSalt: toBase64(new Uint8Array(16).fill(0x01)),
        totpEnabled: false,
        kdfParams: { algorithm: 'pbkdf2', m: 0, t: 0, p: 0, iterations: 1, dkLen: 32 },
      });
      // 包装个密文让 unwrapKey 走得通（用相同 masterKey 即可）
      const fakeKek = new Uint8Array(32).fill(0xaa);
      const fakeMk = new Uint8Array(32).fill(0xcc);
      mockDeriveSecrets.mockResolvedValueOnce({
        kek: fakeKek,
        authKey: new Uint8Array(32).fill(0xbb),
      });
      const wrapped = await (await import('@dustnote/shared')).wrapKey(fakeKek, fakeMk);
      apiPost.mockResolvedValueOnce({
        accessToken: 'tok-unlock',
        userId: 'u-unlock',
        deviceId: 'd-2',
        wrappedMasterKey: wrapped,
      });
      const { actions, state } = makeStore();
      await actions.unlock('mypassword');
      expect(apiGet).toHaveBeenCalledWith('/auth/status');
      expect(apiPost).toHaveBeenCalledWith(
        '/auth/unlock',
        expect.objectContaining({ authKey: expect.any(String) })
      );
      expect(state.accessToken).toBe('tok-unlock');
      expect(state.userId).toBe('u-unlock');
      expect(state.masterKey).toBeInstanceOf(Uint8Array);
    });

    it('serverSalt 已存在 → 不再调 /auth/status（直接派生）', async () => {
      // 提供已存在的 salt，绕开 status 调用
      const { toBase64 } = await import('@dustnote/shared');
      const existingSalt = toBase64(new Uint8Array(16).fill(0x01));
      const fakeKek = new Uint8Array(32).fill(0xaa);
      const fakeMk = new Uint8Array(32).fill(0xcc);
      mockDeriveSecrets.mockResolvedValueOnce({
        kek: fakeKek,
        authKey: new Uint8Array(32).fill(0xbb),
      });
      const wrapped = await (await import('@dustnote/shared')).wrapKey(fakeKek, fakeMk);
      apiPost.mockResolvedValueOnce({
        accessToken: 'tok',
        userId: 'u',
        deviceId: 'd',
        wrappedMasterKey: wrapped,
      });
      const { actions } = makeStore({ serverSalt: existingSalt });
      await actions.unlock('mypassword');
      // 跳过 /auth/status
      expect(apiGet).not.toHaveBeenCalled();
      expect(apiPost).toHaveBeenCalledWith(
        '/auth/unlock',
        expect.objectContaining({ authKey: expect.any(String) })
      );
    });

    it('系统未初始化（status.pwSalt=null）→ 抛 "系统未初始化"', async () => {
      apiGet.mockResolvedValueOnce({ initialized: true, pwSalt: null, totpEnabled: false });
      const { actions } = makeStore();
      await expect(actions.unlock('x')).rejects.toThrow('系统未初始化');
    });
  });

  describe('online logout', () => {
    it('成功通知服务端 + 锁屏', async () => {
      apiPost.mockResolvedValueOnce({ ok: true });
      const { actions, state } = makeStore({
        accessToken: 'tok',
        masterKey: new Uint8Array(32).fill(0x11),
      });
      await actions.logout();
      expect(apiPost).toHaveBeenCalledWith('/auth/logout', {});
      // 锁屏：masterKey 清空
      expect(state.masterKey).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.authState).toBe('needs_unlock');
    });

    it('服务端 logout 失败也不阻塞本地清理（断网场景）', async () => {
      apiPost.mockRejectedValueOnce(new Error('network'));
      const { actions, state } = makeStore({
        accessToken: 'tok',
        masterKey: new Uint8Array(32),
      });
      await expect(actions.logout()).resolves.toBeUndefined();
      // 本地仍清
      expect(state.masterKey).toBeNull();
      expect(state.accessToken).toBeNull();
    });
  });

  describe('online recover（恢复码 → 重设密码）', () => {
    it('happy path：拿 rcSalt + derive + /auth/recover 拿 wrappedMk + unwrap + /auth/rewrap 改密码', async () => {
      // 1) /auth/recovery-params → 拿 rcSalt
      apiGet.mockResolvedValueOnce({
        rcSalt: toBase64(new Uint8Array(16).fill(0x05)),
      });
      // 2) derive 出 kek + authKey（rc 那次）
      const fakeRcKek = new Uint8Array(32).fill(0xaa);
      const fakeRcAuthKey = new Uint8Array(32).fill(0xab);
      // 3) /auth/recover 拿 wrappedMasterKey
      const fakeMk = new Uint8Array(32).fill(0xcc);
      const wrappedMk = await (await import('@dustnote/shared')).wrapKey(fakeRcKek, fakeMk);
      apiPost.mockResolvedValueOnce({
        accessToken: 'tok-recover',
        userId: 'u-recover',
        deviceId: 'd-recover',
        wrappedMasterKey: wrappedMk,
      });
      // 4) 第二次 derive（新密码 + 新 salt）
      const fakeNewKek = new Uint8Array(32).fill(0xdd);
      const fakeNewAuthKey = new Uint8Array(32).fill(0xde);
      mockDeriveSecrets
        .mockResolvedValueOnce({ kek: fakeRcKek, authKey: fakeRcAuthKey })
        .mockResolvedValueOnce({ kek: fakeNewKek, authKey: fakeNewAuthKey });
      // 6) /auth/rewrap 改密码
      apiPost.mockResolvedValueOnce({ ok: true });

      const { actions, state } = makeStore();
      await actions.recover('AAAA-BBBB-CCCC-DDDD', 'NewPass123');

      expect(apiGet).toHaveBeenCalledWith('/auth/recovery-params');
      expect(apiPost).toHaveBeenCalledWith(
        '/auth/recover',
        expect.objectContaining({
          recoveryAuthKey: toBase64(fakeRcAuthKey),
          deviceName: 'Web 浏览器（恢复）',
        })
      );
      // 第二次 /auth/rewrap
      expect(apiPost).toHaveBeenCalledWith(
        '/auth/rewrap',
        expect.objectContaining({
          password: expect.objectContaining({
            authKey: toBase64(fakeNewAuthKey),
            salt: expect.any(String),
            wrappedMasterKey: expect.objectContaining({}),
          }),
        })
      );
      // 状态写入
      expect(state.accessToken).toBe('tok-recover');
      expect(state.userId).toBe('u-recover');
      expect(state.masterKey).toBeInstanceOf(Uint8Array);
      expect(state.serverSalt).toBeTruthy();
      expect(state.wrappedMasterKey).toBeTruthy();
      expect(state.authState).toBe('unlocked');
    });

    it('/auth/recovery-params 失败（网络错）→ 抛错', async () => {
      apiGet.mockRejectedValueOnce(new Error('network'));
      const { actions } = makeStore();
      await expect(actions.recover('AAAA-BBBB', 'NewPass123')).rejects.toThrow('network');
    });
  });

  describe('online changePassword（已解锁 → 用 masterPassword 鉴权 + 改密码）', () => {
    it('happy path：salt 已存在 → /auth/unlock + unwrap + /auth/rewrap', async () => {
      // salt 已存在（避免 /auth/status 调用）
      const existingSalt = toBase64(new Uint8Array(16).fill(0x01));
      const fakeKek = new Uint8Array(32).fill(0xaa);
      const fakeMk = new Uint8Array(32).fill(0xcc);
      const fakeAuthKey = new Uint8Array(32).fill(0xbb);
      mockDeriveSecrets
        .mockResolvedValueOnce({ kek: fakeKek, authKey: fakeAuthKey }) // 当前密码派生
        .mockResolvedValueOnce({
          kek: new Uint8Array(32).fill(0xee),
          authKey: new Uint8Array(32).fill(0xff),
        }); // 新密码派生
      const wrappedMk = await (await import('@dustnote/shared')).wrapKey(fakeKek, fakeMk);
      apiPost.mockResolvedValueOnce({
        accessToken: 'tok-cp',
        userId: 'u-cp',
        wrappedMasterKey: wrappedMk,
      });
      // /auth/rewrap
      apiPost.mockResolvedValueOnce({ ok: true });

      const { actions, state } = makeStore({ serverSalt: existingSalt });
      await actions.changePassword('OldPass123', 'NewPass456');

      // 没调 /auth/status（salt 已存在）
      expect(apiGet).not.toHaveBeenCalled();
      expect(apiPost).toHaveBeenCalledWith(
        '/auth/unlock',
        expect.objectContaining({
          authKey: toBase64(fakeAuthKey),
          deviceName: 'Web 浏览器',
        })
      );
      expect(apiPost).toHaveBeenCalledWith(
        '/auth/rewrap',
        expect.objectContaining({
          password: expect.objectContaining({
            authKey: expect.any(String),
            salt: expect.any(String),
            wrappedMasterKey: expect.objectContaining({}),
          }),
        })
      );
      // salt 更新
      expect(state.serverSalt).toBeTruthy();
      expect(state.serverSalt).not.toBe(existingSalt);
      expect(state.wrappedMasterKey).toBeTruthy();
    });

    it('新密码长度 < 6 → 抛 "新主密码至少 6 个字符"（不调任何 API）', async () => {
      const { actions } = makeStore();
      await expect(actions.changePassword('OldPass123', 'abc')).rejects.toThrow(
        '新主密码至少 6 个字符'
      );
      expect(apiGet).not.toHaveBeenCalled();
      expect(apiPost).not.toHaveBeenCalled();
    });

    it('salt 缺失 + /auth/status.pwSalt=null → 抛 "系统未初始化"', async () => {
      apiGet.mockResolvedValueOnce({
        initialized: true,
        pwSalt: null,
        totpEnabled: false,
      });
      const { actions } = makeStore();
      await expect(actions.changePassword('p', 'NewPass123')).rejects.toThrow('系统未初始化');
    });

    it('salt 缺失 + /auth/status 返回 salt → 用 status salt 派生 → 改密码', async () => {
      const statusSalt = toBase64(new Uint8Array(16).fill(0x07));
      const fakeKek = new Uint8Array(32).fill(0xaa);
      const fakeMk = new Uint8Array(32).fill(0xcc);
      const fakeAuthKey = new Uint8Array(32).fill(0xbb);
      mockDeriveSecrets
        .mockResolvedValueOnce({ kek: fakeKek, authKey: fakeAuthKey })
        .mockResolvedValueOnce({
          kek: new Uint8Array(32).fill(0xee),
          authKey: new Uint8Array(32).fill(0xff),
        });
      const wrappedMk = await (await import('@dustnote/shared')).wrapKey(fakeKek, fakeMk);
      apiGet.mockResolvedValueOnce({
        initialized: true,
        pwSalt: statusSalt,
        totpEnabled: false,
      });
      apiPost
        .mockResolvedValueOnce({
          accessToken: 'tok-cp2',
          userId: 'u-cp2',
          wrappedMasterKey: wrappedMk,
        })
        .mockResolvedValueOnce({ ok: true });

      const { actions, state } = makeStore(); // serverSalt 缺失
      await actions.changePassword('OldPass', 'NewPass789');
      // 调了 /auth/status 拿 salt
      expect(apiGet).toHaveBeenCalledWith('/auth/status');
      expect(apiPost).toHaveBeenCalledWith('/auth/unlock', expect.any(Object));
      expect(apiPost).toHaveBeenCalledWith('/auth/rewrap', expect.any(Object));
      expect(state.serverSalt).toBeTruthy();
      expect(state.serverSalt).not.toBe(statusSalt); // 新 salt
    });
  });

  describe('standalone changePassword', () => {
    function standaloneSlice(overrides: Partial<StoreState> = {}) {
      // 断言集中在构造边界这一次：localAuthBlob 的 fixture 只填了 changePassword
      // 分支读到的字段（其余字段本用例用不到），故整体断言成 StoreState。
      const base = {
        mode: 'standalone',
        authState: 'unlocked',
        lockoutState: { failedAttempts: 0, lockedUntil: 0 },
        localAuthBlob: {
          kdf: 'argon2id',
          kdfParams: {},
          pwSalt: toBase64(new Uint8Array(16)),
          passwordHash: toBase64(new Uint8Array(32)),
          passwordWrappedMasterKey: '{}',
        },
        ...overrides,
      } as unknown as StoreState;
      const combined: StoreState = { ...base };
      const set: StoreApi<StoreState>['setState'] = (partial) => {
        const p = typeof partial === 'function' ? partial(combined) : partial;
        Object.assign(combined, p);
      };
      const get = () => combined;
      // zustand 的 StateCreator 签名是 (set, get, api)，这里给最小可用实现。
      const api: StoreApi<StoreState> = {
        setState: set,
        getState: get,
        getInitialState: get,
        subscribe: () => () => undefined,
        destroy: () => undefined,
      };
      const slice = createAuthSlice(set, get, api);
      // 注意：这里**不**把 slice 的初始值回灌 combined——standaloneSlice 的
      // 语义就是「state 由 fixture 决定，slice 只提供 action」，回灌会用
      // slice 的默认值（authState/lockoutState/localAuthBlob）覆盖 fixture。
      return { state: combined, actions: slice };
    }

    it('未初始化（localAuthBlob 为 null）→ 报错', async () => {
      const { actions } = standaloneSlice({ localAuthBlob: null });
      await expect(actions.changePassword('old', 'newPass1')).rejects.toThrow('未初始化');
    });

    it('锁定中 → 报错', async () => {
      const { actions } = standaloneSlice({
        lockoutState: { failedAttempts: 5, lockedUntil: Date.now() + 60_000 },
      });
      await expect(actions.changePassword('old', 'newPass1')).rejects.toThrow(/已锁定/);
    });
  });
});
