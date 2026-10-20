/**
 * version-check 中间件测试
 *
 * 覆盖：
 *  - OPTIONS 放行
 *  - 跳过白名单路径（health/update-manifest/auth/share/public/）
 *  - header 缺失/格式错 → 400
 *  - SemVer 解析失败 → 400
 *  - 低于 FORCE_UPDATE_VERSION → 410 client_version_eol
 *  - 低于 MIN_CLIENT_VERSION → 410 client_version_eol
 *  - 合法请求 → 注入响应头 + 挂 req.client
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../env.js', () => ({
  config: {
    minClientVersion: '2.0.0',
    recommendedClientVersion: '2.5.50',
    serverVersion: '2.99.0',
    forceUpdateVersion: '2.5.40',
    webOrigin: 'http://localhost:5173',
    downloadPageUrl: undefined as string | undefined,
  },
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));

const { versionCheckMiddleware } = await import('./version-check.js');

// headers 恒有值（res.setHeader 写入的响应头收集器），故不必标可选
function runMw(req: any): { status: number; body?: any; headers: Record<string, string> } {
  let status = 0;
  let body: any = null;
  const headers: Record<string, string> = {};
  const res: any = {
    status(c: number) {
      status = c;
      return res;
    },
    json(b: any) {
      body = b;
      return res;
    },
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
  };
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };
  // 让 req.header(name) 工作 —— Express 内部就是 get('x-...') 形式
  req.header = (name: string) => req.headers[name.toLowerCase()] ?? req.headers[name];
  versionCheckMiddleware(req, res, next);
  return { status: status || (nextCalled ? 200 : 0), body, headers };
}

const validHeaders = {
  'x-client-version': '2.5.40',
  'x-client-platform': 'web',
  'x-client-channel': 'stable',
  'x-client-device-id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

describe('versionCheckMiddleware', () => {
  it('OPTIONS 放行（CORS 预检）', () => {
    const r = runMw({ method: 'OPTIONS', path: '/notes', headers: {} });
    expect(r.status).toBe(200); // next() was called
  });

  it('白名单路径放行：/health', () => {
    const r = runMw({ method: 'GET', path: '/health', headers: {} });
    expect(r.status).toBe(200);
  });

  it('白名单路径放行：/update-manifest', () => {
    const r = runMw({ method: 'GET', path: '/update-manifest', headers: {} });
    expect(r.status).toBe(200);
  });

  it('白名单路径放行：/auth/unlock', () => {
    const r = runMw({ method: 'POST', path: '/auth/unlock', headers: {} });
    expect(r.status).toBe(200);
  });

  it('白名单路径放行：/share/public/<id>', () => {
    const r = runMw({ method: 'GET', path: '/share/public/abc123', headers: {} });
    expect(r.status).toBe(200);
  });

  it('缺 X-Client-Version → 400 missing_client_headers', () => {
    const r = runMw({
      method: 'GET',
      path: '/notes',
      headers: {
        'x-client-platform': 'web',
        'x-client-channel': 'stable',
        'x-client-device-id': 'd',
      },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('missing_client_headers');
  });

  it('缺 X-Client-Device-Id → 400', () => {
    const r = runMw({
      method: 'GET',
      path: '/notes',
      headers: { 'x-client-version': '2.5.0', 'x-client-platform': 'web' },
    });
    expect(r.status).toBe(400);
  });

  it('非法 platform → 400', () => {
    const r = runMw({
      method: 'GET',
      path: '/notes',
      headers: { ...validHeaders, 'x-client-platform': 'symbian' },
    });
    expect(r.status).toBe(400);
  });

  it('deviceId 过短 → 400', () => {
    const r = runMw({
      method: 'GET',
      path: '/notes',
      headers: { ...validHeaders, 'x-client-device-id': 'short' },
    });
    expect(r.status).toBe(400);
  });

  it('合法请求 → 200 + 注入版本响应头', () => {
    const r = runMw({ method: 'GET', path: '/notes', headers: validHeaders });
    expect(r.status).toBe(200);
    expect(r.headers['x-min-client-version']).toBe('2.0.0');
    expect(r.headers['x-recommended-client-version']).toBe('2.5.50');
    expect(r.headers['x-server-version']).toBe('2.99.0');
  });

  it('合法请求挂 req.client 给下游使用', () => {
    let captured: any = null;
    const req: any = { method: 'GET', path: '/notes', headers: validHeaders };
    req.header = (n: string) => req.headers[n.toLowerCase()];
    const res: any = {
      status() {
        return res;
      },
      json() {
        return res;
      },
      setHeader() {
        /* noop */
      },
    };
    const next = () => {
      captured = req.client;
    };
    versionCheckMiddleware(req, res, next);
    expect(captured).toEqual({
      version: '2.5.40',
      platform: 'web',
      channel: 'stable',
      deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
  });
});

describe('versionCheckMiddleware — 强制升级（forceUpdateVersion）', () => {
  it('client < forceUpdateVersion → 410 client_version_eol', () => {
    // 通过 env config 模拟：minClientVersion=2.0.0, forceUpdateVersion=2.5.40
    // ——已在文件顶部 mock 中把 forceUpdateVersion 设为 '2.5.40'
    let status = 0;
    let body: any = null;
    const req: any = {
      method: 'GET',
      path: '/notes',
      headers: { ...validHeaders, 'x-client-version': '2.0.5' },
    };
    req.header = (n: string) => req.headers[n.toLowerCase()];
    const res: any = {
      status(c: number) {
        status = c;
        return res;
      },
      json(b: any) {
        body = b;
        return res;
      },
      setHeader() {
        /* noop */
      },
    };
    versionCheckMiddleware(req, res, () => undefined);
    expect(status).toBe(410);
    expect(body.error).toBe('client_version_eol');
  });

  it('client < minClientVersion → 410 client_version_eol', () => {
    let status = 0;
    let body: any = null;
    const req: any = {
      method: 'GET',
      path: '/notes',
      headers: { ...validHeaders, 'x-client-version': '1.9.0' },
    };
    req.header = (n: string) => req.headers[n.toLowerCase()];
    const res: any = {
      status(c: number) {
        status = c;
        return res;
      },
      json(b: any) {
        body = b;
        return res;
      },
      setHeader() {
        /* noop */
      },
    };
    versionCheckMiddleware(req, res, () => undefined);
    expect(status).toBe(410);
    expect(body.error).toBe('client_version_eol');
  });

  it('合法 SemVer → 通过', () => {
    // 2.5.40 == forceUpdateVersion,不严格小于 → 通过
    const req: any = {
      method: 'GET',
      path: '/notes',
      headers: validHeaders,
    };
    req.header = (n: string) => req.headers[n.toLowerCase()];
    const res: any = {
      status() {
        return res;
      },
      json() {
        return res;
      },
      setHeader() {
        /* noop */
      },
    };
    let nextCalled = false;
    versionCheckMiddleware(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });
});

describe('versionCheckMiddleware — 非法 SemVer', () => {
  it('非法 SemVer 字符串 → 400 invalid_client_version', () => {
    let status = 0;
    let body: any = null;
    const req: any = {
      method: 'GET',
      path: '/notes',
      headers: { ...validHeaders, 'x-client-version': 'not-a-version' },
    };
    req.header = (n: string) => req.headers[n.toLowerCase()];
    const res: any = {
      status(c: number) {
        status = c;
        return res;
      },
      json(b: any) {
        body = b;
        return res;
      },
      setHeader() {
        /* noop */
      },
    };
    versionCheckMiddleware(req, res, () => undefined);
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_client_version');
  });
});
