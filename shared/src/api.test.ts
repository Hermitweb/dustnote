/**
 * shared/api.ts 单测 —— ApiClient + ApiException
 *
 * 跨端 HTTP 客户端：自动注入 X-Client-* 头、处理 401/410、JSON 序列化、body 透传。
 * 用注入的 FetchFn 隔离网络层，让单测不依赖真 fetch。
 */
import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ApiClient, ApiException, type FetchFn, type FetchResponse } from './api.js';

/** 带 .mock 可调用属性的 FetchFn（供断言读 f.mock.calls）。 */
type MockFetch = Mock<FetchFn> & FetchFn;

/** 构造一个 FetchFn mock：返回预设的 status/body/headers。 */
function mockFetch(spec: {
  status?: number;
  body?: string;
  ok?: boolean;
  captureUrl?: string;
  captureInit?: unknown;
}): MockFetch {
  const fn = vi.fn<FetchFn>(async (url, init) => {
    spec.captureUrl = url;
    spec.captureInit = init;
    const status = spec.status ?? 200;
    const body = spec.body ?? '{}';
    return {
      ok: spec.ok ?? (status >= 200 && status < 300),
      status,
      statusText: status === 200 ? 'OK' : status === 401 ? 'Unauthorized' : 'Err',
      text: async () => body,
    } satisfies FetchResponse;
  }) as unknown as MockFetch;
  return fn;
}

const baseOpts = {
  baseUrl: 'https://api.example.com',
  clientVersion: '1.2.3',
  platform: 'web' as const,
  channel: 'stable' as const,
  deviceId: 'dev-uuid-1',
};

describe('ApiClient', () => {
  describe('headers', () => {
    it('自动注入 X-Client-* 四件套 + 默认 Content-Type', async () => {
      const f = mockFetch({ body: '{}' });
      const c = new ApiClient({ ...baseOpts, fetch: f });
      await c.get('/health');
      const init = f.mock.calls[0]![1] as { headers: Record<string, string> };
      expect(init.headers['X-Client-Version']).toBe('1.2.3');
      expect(init.headers['X-Client-Platform']).toBe('web');
      expect(init.headers['X-Client-Channel']).toBe('stable');
      expect(init.headers['X-Client-Device-Id']).toBe('dev-uuid-1');
      expect(init.headers['Content-Type']).toBe('application/json');
    });

    it('accessToken 存在 → 注入 Bearer Authorization', async () => {
      const f = mockFetch({ body: '{}' });
      const c = new ApiClient({ ...baseOpts, fetch: f, accessToken: 'tok-abc' });
      await c.get('/me');
      const init = f.mock.calls[0]![1] as { headers: Record<string, string> };
      expect(init.headers['Authorization']).toBe('Bearer tok-abc');
    });

    it('调用方显式 Content-Type → 不被默认覆盖（extra 透传优先）', async () => {
      const f = mockFetch({ body: '{}' });
      const c = new ApiClient({ ...baseOpts, fetch: f });
      await c.request(
        'POST',
        '/upload',
        { x: 1 },
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      const init = f.mock.calls[0]![1] as { headers: Record<string, string> };
      // 注意：headers() 逻辑里仅在 extra===undefined 时才默认设置 Content-Type；
      // 传入 extra 时由调用方自负。
      expect(init.headers['Content-Type']).toBe('multipart/form-data');
    });
  });

  describe('request body', () => {
    it('body 为对象 → JSON 序列化', async () => {
      const f = mockFetch({ body: '{"ok":true}' });
      const c = new ApiClient({ ...baseOpts, fetch: f });
      const res = await c.post('/x', { a: 1, b: 'x' });
      expect(res).toEqual({ ok: true });
      const init = f.mock.calls[0]![1] as { body: string; method: string };
      expect(init.method).toBe('POST');
      expect(init.body).toBe('{"a":1,"b":"x"}');
    });

    it('body=undefined → 不发送 body', async () => {
      const f = mockFetch({ body: '{}' });
      const c = new ApiClient({ ...baseOpts, fetch: f });
      await c.get('/x');
      const init = f.mock.calls[0]![1] as { body?: string };
      expect(init.body).toBeUndefined();
    });
  });

  describe('parseResponse', () => {
    it('200 + 合法 JSON → 返回解析结果', async () => {
      const f = mockFetch({ status: 200, body: '{"id":1,"name":"n"}' });
      const c = new ApiClient({ ...baseOpts, fetch: f });
      const res = await c.get<{ id: number; name: string }>('/notes/1');
      expect(res).toEqual({ id: 1, name: 'n' });
    });

    it('401 → 抛 ApiException（带 code/message）', async () => {
      const f = mockFetch({ status: 401, body: '{"error":"unauthorized","message":"请重新登录"}' });
      const c = new ApiClient({ ...baseOpts, fetch: f });
      await expect(c.get('/secret')).rejects.toMatchObject({
        name: 'ApiException',
        err: { status: 401, code: 'unauthorized', message: '请重新登录' },
      });
    });

    it('410 → 抛 ApiException', async () => {
      const f = mockFetch({ status: 410, body: '{"error":"gone"}' });
      const c = new ApiClient({ ...baseOpts, fetch: f });
      await expect(c.get('/g')).rejects.toMatchObject({ err: { status: 410, code: 'gone' } });
    });

    it('非 JSON 错误响应 → 抛 ApiException(code=unknown)', async () => {
      const f = mockFetch({ status: 500, body: '<html>500</html>' });
      const c = new ApiClient({ ...baseOpts, fetch: f });
      await expect(c.get('/broken')).rejects.toMatchObject({
        err: { status: 500, code: 'unknown' },
      });
    });

    it('空 body + ok=true → 返回 null（data 初始为 null）', async () => {
      const f = mockFetch({ status: 200, body: '' });
      const c = new ApiClient({ ...baseOpts, fetch: f });
      const res = await c.get<null>('/empty');
      expect(res).toBeNull();
    });
  });

  describe('HTTP method shortcuts', () => {
    it.each([
      ['get', 'GET'],
      ['post', 'POST'],
      ['put', 'PUT'],
      ['patch', 'PATCH'],
      ['delete', 'DELETE'],
    ] as const)('%s → method=%s', async (m, expected) => {
      const f = mockFetch({ body: '{}' });
      const c = new ApiClient({ ...baseOpts, fetch: f });
      // 动态分发：union 方法调用，TS 取最宽松签名，body 参数合法
      await c[m]('/p', { x: 1 });
      const init = f.mock.calls[0]![1] as { method: string };
      expect(init.method).toBe(expected);
    });
  });

  describe('URL 拼接', () => {
    it('baseUrl + path 直接字符串拼接', async () => {
      const f = mockFetch({ body: '{}' });
      const c = new ApiClient({ ...baseOpts, baseUrl: 'https://x.com', fetch: f });
      await c.get('/notes');
      const url = f.mock.calls[0]![0];
      expect(url).toBe('https://x.com/notes');
    });
  });

  describe('ApiException', () => {
    it('继承 Error，name=ApiException，err 字段暴露', () => {
      const e = new ApiException({ status: 400, code: 'bad', message: 'bad request' });
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe('ApiException');
      expect(e.message).toBe('bad request');
      expect(e.err).toEqual({ status: 400, code: 'bad', message: 'bad request' });
    });
  });
});
