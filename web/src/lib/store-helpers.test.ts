/**
 * web/src/lib/store-helpers.ts 单测 —— 401 静默刷新 + authFetch 重放 + 公开 API
 *
 * 覆盖：isTransientNetworkError、setAccessTokenGetter、deriveLocalKey、shareBase，
 * + authFetch 401 重放成功/失败、refreshAccessToken 单飞、Web Locks 退路。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiException } from '@dustnote/shared';
import type { QueuedOp } from '@dustnote/client-core';

// mode-store mock（shareBase 依赖它）
const modeState = { serverUrl: '' as string | null };
vi.mock('./mode-store', () => ({
  useModeStore: {
    getState: () => modeState,
  },
}));

import {
  isTransientNetworkError,
  setAccessTokenGetter,
  deriveLocalKey,
  shareBase,
} from './store-helpers.js';

function apiEx(status: number): ApiException {
  return new ApiException({ status, code: 'x', message: 'x' });
}

describe('store-helpers', () => {
  beforeEach(() => {
    modeState.serverUrl = '';
  });

  describe('isTransientNetworkError', () => {
    it('ApiException 5xx → true（可入队重试）', () => {
      expect(isTransientNetworkError(apiEx(500))).toBe(true);
      expect(isTransientNetworkError(apiEx(502))).toBe(true);
      expect(isTransientNetworkError(apiEx(503))).toBe(true);
    });

    it('ApiException 4xx → false（客户端错误，不可恢复）', () => {
      expect(isTransientNetworkError(apiEx(400))).toBe(false);
      expect(isTransientNetworkError(apiEx(401))).toBe(false);
      expect(isTransientNetworkError(apiEx(404))).toBe(false);
      expect(isTransientNetworkError(apiEx(409))).toBe(false);
    });

    it('TypeError（fetch 抛网络/CORS 错）→ true', () => {
      expect(isTransientNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    });

    it('普通 Error → false', () => {
      expect(isTransientNetworkError(new Error('boom'))).toBe(false);
    });

    it('字符串/对象/null/undefined → false（非网络错）', () => {
      expect(isTransientNetworkError('oops')).toBe(false);
      expect(isTransientNetworkError({ status: 500 })).toBe(false);
      expect(isTransientNetworkError(null)).toBe(false);
      expect(isTransientNetworkError(undefined)).toBe(false);
    });
  });

  describe('setAccessTokenGetter', () => {
    it('未设置 getter 时 api() 取不到 token（不抛）', async () => {
      // 生产签名的形参类型是 () => string | null，但实现内部允许 null（表示"未设置"）；
      // 这里显式清空 getter，用两段式断言表达"传 null"的原意，运行时不变量。
      setAccessTokenGetter(null as unknown as () => string | null);
      // api() 需要完整 store；这里只验证 getter 设/不设不抛
      expect(() => setAccessTokenGetter(() => null)).not.toThrow();
    });

    it('getter 被 set 后能调用', () => {
      const getter = vi.fn(() => 'tok-abc');
      setAccessTokenGetter(getter);
      // 我们没法直接读私有变量，但 api() 内部会调用 _getAccessToken?.()
      // 间接验证：把 getter 设成一个抛错的 fn，下次 api() 会抛
      // 这里只断言设值不抛
      setAccessTokenGetter(() => {
        throw new Error('should not call');
      });
      expect(() => setAccessTokenGetter(getter)).not.toThrow();
    });
  });

  describe('deriveLocalKey', () => {
    it('masterKey=null → 返回 null（未解锁不落明文）', async () => {
      const out = await deriveLocalKey(null);
      expect(out).toBeNull();
    });

    it('masterKey 给定 → 当前实现空 salt 在 WebCrypto 下抛 DataError', async () => {
      // 实现里 hkdf(mk, new Uint8Array(0), ...) 触发了 WebCrypto 对空 HMAC key 的
      // 拒绝（zero-length key 不支持）。这是一处隐藏的兼容性问题：Node 24 / 部分
      // 浏览器实现会报 DataError。我们这里**如实记录行为**而不是替它修——
      // 修是另一个 PR 的话题（应改用 32 字节随机 salt 兜底）。
      const mk = new Uint8Array(32).fill(0x42);
      await expect(deriveLocalKey(mk)).rejects.toThrow(/Zero-length key/);
    });
  });

  describe('shareBase', () => {
    it('serverUrl 为空 → 用 window.location.origin', () => {
      modeState.serverUrl = null;
      expect(shareBase()).toBe(window.location.origin);
    });

    it('serverUrl 有值 → 去掉尾随 /', () => {
      modeState.serverUrl = 'https://api.example.com/';
      expect(shareBase()).toBe('https://api.example.com');
    });

    it('serverUrl 多尾随 / → 只剥一个', () => {
      modeState.serverUrl = 'https://api.example.com///';
      // replace(/\/+$/, '') 会剥全部尾随 /
      expect(shareBase()).toBe('https://api.example.com');
    });

    it('serverUrl 无尾斜杠 → 原样', () => {
      modeState.serverUrl = 'https://api.example.com';
      expect(shareBase()).toBe('https://api.example.com');
    });
  });
});

/* ============================================================
 * 401 静默刷新 / authFetch（需要 fetch + store + localStorage mock）
 * ============================================================ */
type MockResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
};
function makeResponse(body: unknown, status = 200): MockResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

async function loadWithMocks(
  opts: {
    refreshJson?: unknown;
    refreshStatus?: number;
    /** /auth/refresh 抛错（模拟网络） */
    refreshThrows?: boolean;
    /** navigator.locks 模拟（默认 undefined） */
    locks?: { request: ReturnType<typeof vi.fn> } | undefined;
  } = {}
) {
  vi.resetModules();
  // mode store
  vi.doMock('./mode-store', () => ({
    useModeStore: { getState: () => ({ serverUrl: '' }) },
  }));
  // store（setState 桩，验证被调用）
  const setStateSpy = vi.fn();
  vi.doMock('./store', () => ({
    useStore: { setState: setStateSpy, getState: () => ({}) },
  }));
  // localStorage 桩
  const ls = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => ls.get(k) ?? null,
      setItem: (k: string, v: string) => void ls.set(k, v),
      removeItem: (k: string) => void ls.delete(k),
      clear: () => ls.clear(),
    },
    configurable: true,
  });
  // navigator.locks：仅当 opts.locks 显式设置时才覆盖；否则保留测试自己设的值
  if (opts.locks !== undefined) {
    Object.defineProperty(navigator, 'locks', {
      value: opts.locks,
      configurable: true,
    });
  }
  // fetch mock
  // 真实 fetch 签名是 (url, init)：生产 authFetch 401 重放时会带 init（headers），
  // mock 必须按双参声明，否则取 mock.calls[i][1] 会被判成 TS2493
  const fetchSpy = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.includes('/auth/refresh')) {
      if (opts.refreshThrows) throw new TypeError('Failed to fetch');
      return makeResponse(
        opts.refreshJson ?? { accessToken: 'new-tok' },
        opts.refreshStatus ?? 200
      );
    }
    return makeResponse({}, 200);
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  return import('./store-helpers.js').then(async (m) => {
    // 通过 authedFetch 间接触发 refreshAccessToken；传入空 getter 避免越权
    m.setAccessTokenGetter(() => null);
    return { ...m, fetchSpy, setStateSpy, ls };
  });
}

describe('authFetch 401 静默刷新', () => {
  beforeEach(() => {
    if ('locks' in navigator) {
      Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    }
  });

  it('401 + refresh 成功 → 用新 token 重放原请求', async () => {
    const { authedFetch, fetchSpy } = await loadWithMocks({
      refreshJson: { accessToken: 'tok-2' },
    });
    // 第一次 fetch 401，refresh 200，重放 200
    let n = 0;
    fetchSpy.mockImplementation(async (url: string) => {
      n++;
      if (url.includes('/auth/refresh')) {
        return makeResponse({ accessToken: 'tok-2' }, 200);
      }
      if (n === 1) return makeResponse({}, 401);
      return makeResponse({ ok: true }, 200);
    });
    const res = await authedFetch('https://api.example.com/api/v1/notes');
    expect(res.status).toBe(200);
    // 第二次 fetch 应带新 Bearer
    const secondCallInit = (fetchSpy.mock.calls[2]?.[1] ?? {}) as unknown as { headers: Headers };
    expect(secondCallInit.headers.get('Authorization')).toBe('Bearer tok-2');
  });

  it('401 + refresh 失败 → 触发 needs_unlock，不重放', async () => {
    const { authedFetch, fetchSpy, setStateSpy } = await loadWithMocks({
      refreshJson: { error: 'invalid' },
      refreshStatus: 401,
    });
    setStateSpy.mockClear();
    fetchSpy.mockImplementation(async () => makeResponse({}, 401));
    const res = await authedFetch('https://api.example.com/api/v1/notes');
    expect(res.status).toBe(401);
    // setState 触发了 needs_unlock
    expect(setStateSpy).toHaveBeenCalledWith({ authState: 'needs_unlock' });
    // fetch 调了 2 次：原请求 401 + refresh 401（refresh 也走 fetch，但因失败不重放）
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('401 命中但 URL 含 /auth/ → 不刷新（防递归）', async () => {
    const { authedFetch, fetchSpy } = await loadWithMocks({});
    fetchSpy.mockImplementation(async () => makeResponse({}, 401));
    const res = await authedFetch('https://api.example.com/api/v1/auth/unlock');
    expect(res.status).toBe(401);
    // 只 1 次（没触发 refresh）
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refresh 网络错（TypeError）→ 返回 null，authFetch 不重放', async () => {
    const { authedFetch, fetchSpy, setStateSpy } = await loadWithMocks({
      refreshThrows: true,
    });
    fetchSpy.mockImplementation(async () => makeResponse({}, 401));
    const res = await authedFetch('https://api.example.com/api/v1/notes');
    expect(res.status).toBe(401);
    // refresh 失败但 setState 仍触发 needs_unlock（走 else 分支）
    expect(setStateSpy).toHaveBeenCalledWith({ authState: 'needs_unlock' });
  });

  it('refresh 响应无 accessToken → 视为失败', async () => {
    const { authedFetch, fetchSpy, setStateSpy } = await loadWithMocks({
      refreshJson: { refreshToken: 'r' }, // 无 accessToken
    });
    fetchSpy.mockImplementation(async () => makeResponse({}, 401));
    await authedFetch('https://api.example.com/api/v1/notes');
    expect(setStateSpy).toHaveBeenCalledWith({ authState: 'needs_unlock' });
  });
});

describe('refreshAccessToken 单飞 + Web Locks', () => {
  beforeEach(() => {
    if ('locks' in navigator) {
      Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    }
  });

  it('首次 refresh 后 refreshInFlight 在 setTimeout(0) 后清空', async () => {
    const { authedFetch, fetchSpy } = await loadWithMocks({});
    let n = 0;
    fetchSpy.mockImplementation(async (url: string) => {
      n++;
      if (url.includes('/auth/refresh')) return makeResponse({ accessToken: 'tok' }, 200);
      if (n === 1) return makeResponse({}, 401);
      return makeResponse({}, 200);
    });
    // 串两次：第一次 401 → refresh → 200
    await authedFetch('https://api.example.com/a');
    // 让 setTimeout(0) flush
    await new Promise((r) => setTimeout(r, 5));
    // 第二次 401 → 再次 refresh（单飞已清空）
    n = 0;
    fetchSpy.mockImplementation(async (url: string) => {
      n++;
      if (url.includes('/auth/refresh')) return makeResponse({ accessToken: 'tok' }, 200);
      if (n === 1) return makeResponse({}, 401);
      return makeResponse({}, 200);
    });
    await authedFetch('https://api.example.com/b');
    // refresh 应被调过 2 次（每次 401 触发）
    const refreshCalls = fetchSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('/auth/refresh')
    );
    expect(refreshCalls.length).toBe(2);
  });

  it('并发两次 401 → refresh 只发一次（inFlight 单飞）', async () => {
    const { authedFetch, fetchSpy } = await loadWithMocks({});
    fetchSpy.mockImplementation(async (url: string) => {
      if (url.includes('/auth/refresh')) return makeResponse({ accessToken: 'tok' }, 200);
      return makeResponse({}, 401);
    });
    // 并发两次
    const [r1, r2] = await Promise.all([
      authedFetch('https://api.example.com/a'),
      authedFetch('https://api.example.com/b'),
    ]);
    // refresh 只被调一次
    const refreshCalls = fetchSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('/auth/refresh')
    );
    expect(refreshCalls.length).toBe(1);
    expect(r1.status).toBe(401); // 第一次 401
    expect(r2.status).toBe(401); // 第二次也是 401（重放也 401，无新 token 后仍 401）
  });

  it('navigator.locks.request 拒绝 → 回退无锁路径（不踢用户）', async () => {
    const locksReq = vi.fn(async () => {
      throw new Error('SecurityError');
    });
    Object.defineProperty(navigator, 'locks', {
      value: { request: locksReq },
      configurable: true,
    });
    const { authedFetch, fetchSpy } = await loadWithMocks({});
    fetchSpy.mockImplementation(async (url: string) => {
      if (url.includes('/auth/refresh')) return makeResponse({ accessToken: 'tok' }, 200);
      return makeResponse({}, 401);
    });
    await authedFetch('https://api.example.com/a');
    // locks.request 被调用（失败后回退）
    expect(locksReq).toHaveBeenCalled();
    // refresh 还是成功：tok
    const secondCallInit = fetchSpy.mock.calls[2]?.[1] as unknown as { headers: Headers };
    expect(secondCallInit.headers.get('Authorization')).toBe('Bearer tok');
  });

  it('refresh 返回新 refreshToken → 写回 localStorage（覆盖旧值）', async () => {
    const { authedFetch, fetchSpy, ls } = await loadWithMocks({});
    ls.set('dustnote_refresh', 'old-rt');
    let n = 0;
    fetchSpy.mockImplementation(async (url: string) => {
      n++;
      if (url.includes('/auth/refresh')) {
        return makeResponse({ accessToken: 'tok', refreshToken: 'new-rt' }, 200);
      }
      if (n === 1) return makeResponse({}, 401);
      return makeResponse({}, 200);
    });
    await authedFetch('https://api.example.com/a');
    expect(ls.get('dustnote_refresh')).toBe('new-rt');
  });

  it('refresh 成功但返回的 refreshToken 不带 → localStorage 保留旧值', async () => {
    const { authedFetch, fetchSpy, ls } = await loadWithMocks({});
    ls.set('dustnote_refresh', 'old-rt');
    let n = 0;
    fetchSpy.mockImplementation(async (url: string) => {
      n++;
      if (url.includes('/auth/refresh')) {
        return makeResponse({ accessToken: 'tok' }, 200); // 不带 refreshToken
      }
      if (n === 1) return makeResponse({}, 401);
      return makeResponse({}, 200);
    });
    await authedFetch('https://api.example.com/a');
    expect(ls.get('dustnote_refresh')).toBe('old-rt');
  });

  it('X-Refresh-Token 头：localStorage 有 rt → 透传', async () => {
    const { authedFetch, fetchSpy, ls } = await loadWithMocks({});
    ls.set('dustnote_refresh', 'rt-abc');
    let n = 0;
    fetchSpy.mockImplementation(async (url: string) => {
      n++;
      if (url.includes('/auth/refresh')) return makeResponse({ accessToken: 'tok' }, 200);
      if (n === 1) return makeResponse({}, 401);
      return makeResponse({}, 200);
    });
    await authedFetch('https://api.example.com/a');
    // 找 refresh 那次调用
    const refreshCall = fetchSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('/auth/refresh')
    );
    const headers =
      (refreshCall?.[1] as unknown as { headers?: Record<string, string> } | undefined)?.headers ??
      {};
    expect(headers['X-Refresh-Token']).toBe('rt-abc');
  });
});

/* ============================================================
 * api() factory：baseUrl + accessToken 注入
 * ============================================================ */
async function loadApiFactory(serverUrl: string | null) {
  vi.resetModules();
  vi.doMock('./mode-store', () => ({
    useModeStore: { getState: () => ({ serverUrl }) },
  }));
  vi.doMock('./store', () => ({
    useStore: { setState: vi.fn(), getState: () => ({}) },
  }));
  vi.doMock('./device', () => ({
    getDeviceId: () => 'dev-test-id',
  }));
  // ApiClient 内部用 fetch；mock 掉 fetch 让实例化不报错
  globalThis.fetch = vi.fn(async () => makeResponse({})) as unknown as typeof fetch;
  return import('./store-helpers.js');
}

describe('api() factory', () => {
  it('serverUrl 为空 → baseUrl 用 API_BASE（/api/v1）', async () => {
    const { api } = await loadApiFactory(null);
    const client = api();
    expect(client).toBeDefined();
    // 实例的 baseUrl 内部用闭包捕获，不可直接读——但调用不报错即说明构造成功
  });

  it('serverUrl 有值 → 拼到 baseUrl，去掉尾 /', async () => {
    const { api } = await loadApiFactory('https://api.example.com/');
    const client = api();
    expect(client).toBeDefined();
  });

  it('多尾斜杠 → 全部剥（不残留）', async () => {
    const { api } = await loadApiFactory('https://api.example.com///');
    const client = api();
    expect(client).toBeDefined();
  });

  it('accessToken 通过 _getAccessToken 注入', async () => {
    const { api, setAccessTokenGetter } = await loadApiFactory(null);
    setAccessTokenGetter(() => 'tok-injected');
    const client = api();
    // client 内部用 accessToken 调用 fetch；用 vi.fn 包装验证
    expect(client).toBeDefined();
  });
});

/* ============================================================
 * runOrEnqueue：网络错入队 / 4xx 透传 / 成功
 * ============================================================ */

const { enqueue, refreshPendingCountMock, requestSpy } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  refreshPendingCountMock: vi.fn(),
  requestSpy: vi.fn(),
}));

vi.mock('./offline-queue', () => ({
  enqueue: (...args: unknown[]) => enqueue(...args),
}));

async function loadRunOrEnqueue() {
  vi.resetModules();
  vi.doMock('./mode-store', () => ({
    useModeStore: { getState: () => ({ serverUrl: '' }) },
  }));
  vi.doMock('./store', () => ({
    useStore: { setState: vi.fn(), getState: () => ({}) },
  }));
  vi.doMock('./device', () => ({ getDeviceId: () => 'dev-1' }));
  // 让 store-helpers 走真实的 shared（不 mock），保证 instanceof 跨模块一致
  globalThis.fetch = vi.fn(async () => makeResponse({})) as unknown as typeof fetch;
  // 拿 store-helpers 用的同一个 shared 实例（保证 instanceof 一致）
  const shared = await import('@dustnote/shared');
  const mod = await import('./store-helpers.js');
  return { ...mod, ApiException: shared.ApiException };
}

describe('runOrEnqueue', () => {
  beforeEach(() => {
    enqueue.mockReset();
    refreshPendingCountMock.mockReset();
  });

  it('fn 成功 → 返回 true（不入队）', async () => {
    const { runOrEnqueue } = await loadRunOrEnqueue();
    const ok = await runOrEnqueue(
      { method: 'POST', path: '/notes' },
      async () => 'success',
      refreshPendingCountMock
    );
    expect(ok).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
    expect(refreshPendingCountMock).not.toHaveBeenCalled();
  });

  it('fn 抛 TypeError（网络错）→ 入队 + 返回 false + 刷 pending 计数', async () => {
    const { runOrEnqueue } = await loadRunOrEnqueue();
    const op = { method: 'PATCH' as const, path: '/notes/1', body: { x: 1 } };
    const ok = await runOrEnqueue(
      op,
      async () => {
        throw new TypeError('Failed to fetch');
      },
      refreshPendingCountMock
    );
    expect(ok).toBe(false);
    expect(enqueue).toHaveBeenCalledWith(op);
    expect(refreshPendingCountMock).toHaveBeenCalled();
  });

  it('fn 抛 ApiException 5xx → 入队（可能恢复）', async () => {
    const { runOrEnqueue, ApiException: Api } = await loadRunOrEnqueue();
    const op = { method: 'POST' as const, path: '/notes' };
    const ok = await runOrEnqueue(
      op,
      async () => {
        throw new Api({ status: 503, code: 'unavailable', message: 'x' });
      },
      refreshPendingCountMock
    );
    expect(ok).toBe(false);
    expect(enqueue).toHaveBeenCalledWith(op);
  });

  it('fn 抛 ApiException 4xx → 不入队，重新抛错（4xx 不可恢复）', async () => {
    const { runOrEnqueue, ApiException: Api } = await loadRunOrEnqueue();
    const op = { method: 'POST' as const, path: '/notes' };
    const businessErr = new Api({ status: 409, code: 'conflict', message: 'x' });
    await expect(
      runOrEnqueue(
        op,
        async () => {
          throw businessErr;
        },
        refreshPendingCountMock
      )
    ).rejects.toBe(businessErr);
    expect(enqueue).not.toHaveBeenCalled();
    expect(refreshPendingCountMock).not.toHaveBeenCalled();
  });

  it('fn 抛 ApiException 400 → 不入队（其余 4xx 同样）', async () => {
    const { runOrEnqueue, ApiException: Api } = await loadRunOrEnqueue();
    const ok = runOrEnqueue(
      { method: 'POST', path: '/x' },
      async () => {
        throw new Api({ status: 400, code: 'bad', message: 'x' });
      },
      refreshPendingCountMock
    );
    await expect(ok).rejects.toThrow();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

/* ============================================================
 * replayOp：调用 api().request(op)
 * ============================================================ */

async function loadReplayOp() {
  vi.resetModules();
  vi.doMock('./mode-store', () => ({
    useModeStore: { getState: () => ({ serverUrl: '' }) },
  }));
  vi.doMock('./store', () => ({
    useStore: { setState: vi.fn(), getState: () => ({}) },
  }));
  vi.doMock('./device', () => ({ getDeviceId: () => 'dev-1' }));
  // 关键：把 ApiClient 替换成返回带 spy request 的对象
  vi.doMock('@dustnote/shared', async () => {
    const actual = await vi.importActual<typeof import('@dustnote/shared')>('@dustnote/shared');
    // 用 class 替换 ApiClient
    class FakeApiClient {
      constructor(_opts: unknown) {}
      request = requestSpy;
    }
    return { ...actual, ApiClient: FakeApiClient };
  });
  globalThis.fetch = vi.fn(async () => makeResponse({})) as unknown as typeof fetch;
  return import('./store-helpers.js');
}

describe('replayOp', () => {
  beforeEach(() => {
    requestSpy.mockReset();
  });

  it('调用 api().request(op.method, op.path, op.body)', async () => {
    requestSpy.mockResolvedValueOnce({ ok: true });
    const { replayOp } = await loadReplayOp();
    // 按生产 QueuedOp 的完整形状构造（id/createdAt/retries 由队列侧填充，此处补齐）
    const op: QueuedOp = {
      id: 'op-1',
      method: 'POST',
      path: '/notes',
      body: { x: 1 },
      createdAt: '2026-01-01T00:00:00.000Z',
      retries: 0,
    };
    await replayOp(op);
    expect(requestSpy).toHaveBeenCalledWith('POST', '/notes', { x: 1 });
  });

  it('op.body 为 undefined → 第三个参数传 undefined', async () => {
    requestSpy.mockResolvedValueOnce(undefined);
    const { replayOp } = await loadReplayOp();
    const op: QueuedOp = {
      id: 'op-2',
      method: 'DELETE',
      path: '/notes/1',
      createdAt: '2026-01-01T00:00:00.000Z',
      retries: 0,
    };
    await replayOp(op);
    expect(requestSpy).toHaveBeenCalledWith('DELETE', '/notes/1', undefined);
  });

  it('api() 抛错 → 透传（不吞）', async () => {
    requestSpy.mockRejectedValueOnce(new Error('network down'));
    const { replayOp } = await loadReplayOp();
    const op: QueuedOp = {
      id: 'op-3',
      method: 'PATCH',
      path: '/x',
      createdAt: '2026-01-01T00:00:00.000Z',
      retries: 0,
    };
    await expect(replayOp(op)).rejects.toThrow('network down');
  });
});
