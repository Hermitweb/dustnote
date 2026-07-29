import { describe, it, expect, beforeAll } from 'vitest';
import type { Request, Response } from 'express';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long-12345';
});

async function loadMiddleware() {
  const [{ authMiddleware }, { issueAccessToken, issueRefreshToken }] = await Promise.all([
    import('./auth.js'),
    import('../auth/jwt.js'),
  ]);
  return { authMiddleware, issueAccessToken, issueRefreshToken };
}

function createReq(overrides: Partial<Request> = {}): Request {
  return {
    path: '/notes',
    header: () => undefined,
    ...overrides,
  } as Request;
}

function withAuth(value: string): Request['header'] {
  return ((name: string) => (name === 'Authorization' ? value : undefined)) as Request['header'];
}

function createRes(): Response {
  const res = {
    statusCode: 200,
    jsonBody: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.jsonBody = body;
      return this;
    },
  };
  return res as unknown as Response;
}

describe('authMiddleware', () => {
  it('skips public paths without authorization', async () => {
    const { authMiddleware } = await loadMiddleware();
    const req = createReq({ path: '/health' });
    const res = createRes();
    let called = false;
    authMiddleware(req, res, () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it.each([
    '/auth/status',
    '/auth/setup',
    '/auth/unlock',
    '/auth/recover',
    '/auth/recovery-params',
  ])('lets %s through without a token', async (path) => {
    const { authMiddleware } = await loadMiddleware();
    const res = createRes();
    let called = false;
    authMiddleware(createReq({ path }), res, () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  it('still requires a token for /auth/rewrap', async () => {
    const { authMiddleware } = await loadMiddleware();
    const res = createRes();
    authMiddleware(createReq({ path: '/auth/rewrap' }), res, () => {});
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const { authMiddleware } = await loadMiddleware();
    const req = createReq();
    const res = createRes();
    authMiddleware(req, res, () => {});
    expect(res.statusCode).toBe(401);
    expect((res as unknown as Record<string, unknown>).jsonBody).toMatchObject({
      error: 'missing_token',
    });
  });

  it('returns 401 for non-Bearer authorization', async () => {
    const { authMiddleware } = await loadMiddleware();
    const req = createReq({ header: withAuth('Basic dXNlcjpwYXNz') });
    const res = createRes();
    authMiddleware(req, res, () => {});
    expect(res.statusCode).toBe(401);
    expect((res as unknown as Record<string, unknown>).jsonBody).toMatchObject({
      error: 'missing_token',
    });
  });

  it('returns 401 for an invalid token', async () => {
    const { authMiddleware } = await loadMiddleware();
    const req = createReq({ header: withAuth('Bearer invalid-token') });
    const res = createRes();
    authMiddleware(req, res, () => {});
    expect(res.statusCode).toBe(401);
    expect((res as unknown as Record<string, unknown>).jsonBody).toMatchObject({
      error: 'invalid_token',
    });
  });

  it('rejects refresh tokens on protected routes', async () => {
    const { authMiddleware, issueRefreshToken } = await loadMiddleware();
    const token = issueRefreshToken('user-1', 'device-1');
    const req = createReq({ header: withAuth(`Bearer ${token}`) });
    const res = createRes();
    authMiddleware(req, res, () => {});
    expect(res.statusCode).toBe(401);
  });

  it('injects req.user for a valid access token', async () => {
    const { authMiddleware, issueAccessToken } = await loadMiddleware();
    const token = issueAccessToken('user-1', 'device-1');
    const req = createReq({ header: withAuth(`Bearer ${token}`) });
    const res = createRes();
    let called = false;
    authMiddleware(req, res, () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(req.user).toEqual({ userId: 'user-1', deviceId: 'device-1' });
  });
});
