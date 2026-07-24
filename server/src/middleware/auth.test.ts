import { describe, it, expect, beforeAll } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

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
  } as unknown as Request;
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
    const req = createReq({
      header: (name: string) => (name === 'Authorization' ? 'Basic dXNlcjpwYXNz' : undefined),
    });
    const res = createRes();
    authMiddleware(req, res, () => {});
    expect(res.statusCode).toBe(401);
    expect((res as unknown as Record<string, unknown>).jsonBody).toMatchObject({
      error: 'missing_token',
    });
  });

  it('returns 401 for an invalid token', async () => {
    const { authMiddleware } = await loadMiddleware();
    const req = createReq({
      header: (name: string) => (name === 'Authorization' ? 'Bearer invalid-token' : undefined),
    });
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
    const req = createReq({
      header: (name: string) => (name === 'Authorization' ? `Bearer ${token}` : undefined),
    });
    const res = createRes();
    authMiddleware(req, res, () => {});
    expect(res.statusCode).toBe(401);
  });

  it('injects req.user for a valid access token', async () => {
    const { authMiddleware, issueAccessToken } = await loadMiddleware();
    const token = issueAccessToken('user-1', 'device-1');
    const req = createReq({
      header: (name: string) => (name === 'Authorization' ? `Bearer ${token}` : undefined),
    });
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
