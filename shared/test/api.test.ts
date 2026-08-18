import { describe, it, expect } from 'vitest';
import { ApiClient, ApiException, type FetchFn, type FetchResponse } from '../src/api.js';

function makeResponse(status: number, body: string, statusText = ''): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: () => Promise.resolve(body),
  };
}

function makeClient(fetchFn: FetchFn, accessToken?: string): ApiClient {
  return new ApiClient({
    baseUrl: 'https://api.example.com',
    clientVersion: '1.0.0',
    platform: 'desktop',
    channel: 'stable',
    deviceId: 'dev1',
    accessToken,
    fetch: fetchFn,
  });
}

describe('ApiClient', () => {
  it('parses 200 JSON response', async () => {
    const mockFetch: FetchFn = () =>
      Promise.resolve(makeResponse(200, JSON.stringify({ hello: 'world' })));
    const client = makeClient(mockFetch);
    const result = await client.get<{ hello: string }>('/test');
    expect(result).toEqual({ hello: 'world' });
  });

  it('throws ApiException on 410', async () => {
    const mockFetch: FetchFn = () =>
      Promise.resolve(
        makeResponse(410, JSON.stringify({ error: 'gone', message: 'version expired' }), 'Gone')
      );
    const client = makeClient(mockFetch);
    await expect(client.get('/test')).rejects.toThrow(ApiException);
    try {
      await client.get('/test');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiException);
      expect((e as ApiException).err.status).toBe(410);
    }
  });

  it('throws ApiException (not SyntaxError) on non-JSON response', async () => {
    const mockFetch: FetchFn = () =>
      Promise.resolve(makeResponse(200, '<html>not json</html>', 'OK'));
    const client = makeClient(mockFetch);
    await expect(client.get('/test')).rejects.toThrow(ApiException);
  });

  it('injects Authorization header', async () => {
    let capturedInit: { method: string; headers: Record<string, string> } | null = null;
    const mockFetch: FetchFn = (_url, init) => {
      capturedInit = init;
      return Promise.resolve(makeResponse(200, JSON.stringify({})));
    };
    const client = makeClient(mockFetch, 'my-token');
    await client.get('/test');
    expect(capturedInit).not.toBeNull();
    expect(capturedInit!.headers['Authorization']).toBe('Bearer my-token');
  });
});
