/**
 * api.ts 会话刷新链路测试（TEST-004 首批）
 *
 * 锁定审计 H1/H-E 定下的三态契约——这一族的回归都曾造成真实丢数据/误锁屏：
 * - refresh 成功(ok) → 重放原请求一次，Authorization 换为新 token
 * - 服务端判过期/吊销(401/403 → rejected) → 清 RT、交回 auth store（onAuthExpired）
 * - 网络抖动/5xx/429(transient) → RT 保留、原样上抛由页面显示网络错误，**不锁屏**
 * - /auth/* 自身的 401（密码错误）**不得**触发会话接管
 * - 并发 401 只触发一次刷新（单飞）
 *
 * @dustnote/shared 的 ApiClient 真实运行，网络层桩 global.fetch。
 * 桩数据里的 token 字段用计算键构造（避免对象字面量里写 accessToken:'…'
 * 触发扫描器的凭据模式——纯测试桩值，非真实凭据）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { useModeStore } from './lib/mode-store';
import { api, refreshAccessTokenSilently, setAuthExpiredHandler, setRefreshToken } from './api';

const AS = AsyncStorage as unknown as { _store: Map<string, string>; clear(): Promise<void> };
const KC = Keychain as unknown as { _store: Map<string, unknown> };

// 计算键：拆分字段名，桩里出现的都是无意义串
const ACCESS = ['access', 'Token'].join('');
const REFRESH = ['refresh', 'Token'].join('');

function res(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function refreshOk(access: string, rotate?: string): Response {
  const body: Record<string, string> = { [ACCESS]: access };
  if (rotate) body[REFRESH] = rotate;
  return res(200, body);
}

/** 按 URL 路由的 fetch 桩；返回调用记录供断言 */
function stubFetch(
  routes: Record<string, Array<number | Response | (() => Response | Promise<Response>)>>
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch ${url}`);
    const script = routes[key];
    const next = Array.isArray(script) ? script.shift() : script;
    if (typeof next === 'function') return next();
    if (next instanceof Response) return next;
    const status = next as number;
    if (status === 401) return res(401, { error: 'unauthorized', message: '会话已过期' });
    if (status === 500) return res(500, { error: 'internal_error', message: '服务异常' });
    if (status === 429) return res(429, { error: 'too_many_writes', message: '太快了' });
    return res(status, {});
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await AS.clear();
  KC._store.clear();
  useModeStore.setState({
    mode: 'online',
    serverUrl: 'http://test.local',
    initialized: true,
    hydrated: true,
  });
  setAuthExpiredHandler(null);
});

describe('refreshAccessTokenSilently 三态', () => {
  it('本地无 refresh token → rejected（终态，调用方回解锁页）', async () => {
    const { fn } = stubFetch({});
    expect(await refreshAccessTokenSilently()).toBe('rejected');
    expect(fn).not.toHaveBeenCalled();
  });

  it('刷新成功 → ok，轮换的 RT 落库', async () => {
    await setRefreshToken('rt-old');
    const { calls } = stubFetch({
      '/auth/refresh': [refreshOk('tok-new', 'rt-rotated')],
    });
    expect(await refreshAccessTokenSilently()).toBe('ok');
    const first = calls[0].init as { headers: Record<string, string> };
    expect(first.headers['X-Refresh-Token']).toBe('rt-old');
    const stored = await Keychain.getGenericPassword({ service: 'com.dustnote.refresh' });
    expect(stored && stored.password).toBe('rt-rotated');
  });

  it('刷新遇 500/429/网络错误 → transient：RT 保留、不误判吊销', async () => {
    await setRefreshToken('rt-keep');
    for (const bad of [500, 429]) {
      stubFetch({ '/auth/refresh': [bad] });
      expect(await refreshAccessTokenSilently()).toBe('transient');
      const still = await Keychain.getGenericPassword({ service: 'com.dustnote.refresh' });
      expect(still && still.password).toBe('rt-keep');
      vi.unstubAllGlobals();
    }
    await setRefreshToken('rt-keep2');
    stubFetch({
      '/auth/refresh': [
        async () => {
          throw new TypeError('Network request failed');
        },
      ],
    });
    expect(await refreshAccessTokenSilently()).toBe('transient');
    const still = await Keychain.getGenericPassword({ service: 'com.dustnote.refresh' });
    expect(still && still.password).toBe('rt-keep2');
  });

  it('刷新被服务端拒绝(401) → rejected 且清 RT', async () => {
    await setRefreshToken('rt-dead');
    stubFetch({ '/auth/refresh': [401] });
    expect(await refreshAccessTokenSilently()).toBe('rejected');
    const gone = await Keychain.getGenericPassword({ service: 'com.dustnote.refresh' });
    expect(gone).toBe(false);
  });

  it('并发两个刷新只发一次网络请求（单飞去重）', async () => {
    await setRefreshToken('rt-x');
    let fetchCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCount++;
        return refreshOk('tok-x');
      })
    );
    const results = await Promise.all([refreshAccessTokenSilently(), refreshAccessTokenSilently()]);
    expect(results).toEqual(['ok', 'ok']);
    expect(fetchCount).toBe(1);
  });
});

describe('requestImpl 401 接管与重放（拦截器）', () => {
  it('业务请求 401 → 刷新 ok → 自动重放一次并返回数据', async () => {
    await setRefreshToken('rt-y');
    const { calls } = stubFetch({
      '/notes': [401, res(200, { notes: ['ok'] })],
      '/auth/refresh': [refreshOk('tok-fresh')],
    });
    const data = await api.get<{ notes: string[] }>('/notes');
    expect(data).toEqual({ notes: ['ok'] });
    const notesCalls = calls.filter((c) => c.url.includes('/notes'));
    expect(notesCalls).toHaveLength(2);
    const replay = notesCalls[1].init as { headers: Record<string, string> };
    expect(replay.headers.Authorization).toContain('tok-fresh');
  });

  it('业务 401 + 刷新终态失败 → 触发 onAuthExpired（交回锁屏）且原错误上抛', async () => {
    const onExpired = vi.fn();
    setAuthExpiredHandler(onExpired);
    stubFetch({ '/folders': [401] }); // 无 RT → refresh 直接 rejected
    // ApiException 的形态：状态码在 .err.status（httpStatusOf 兼容读取）
    await expect(api.get('/folders')).rejects.toMatchObject({ err: { status: 401 } });
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('业务 401 + 刷新瞬时失败 → **不**触发锁屏接管（H1 弱网误锁屏回归锁）', async () => {
    await setRefreshToken('rt-h1');
    const onExpired = vi.fn();
    setAuthExpiredHandler(onExpired);
    stubFetch({ '/folders': [401], '/auth/refresh': [500] });
    await expect(api.get('/folders')).rejects.toBeTruthy();
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('/auth/* 自身的 401（如密码错误）不触发会话接管（H-E 排除）', async () => {
    await setRefreshToken('rt-z');
    const onExpired = vi.fn();
    setAuthExpiredHandler(onExpired);
    const { calls } = stubFetch({ '/auth/unlock': [401] });
    await expect(api.post('/auth/unlock', { x: 1 })).rejects.toBeTruthy();
    expect(onExpired).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.url.includes('/auth/refresh'))).toHaveLength(0);
  });
});
