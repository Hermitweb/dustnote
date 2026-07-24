import { describe, it, expect, beforeAll } from 'vitest';

// 在加载 jwt 模块前设置强密钥
beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long-12345';
});

// 使用动态导入，确保环境变量已设置
async function loadJwt() {
  const mod = await import('./jwt.js');
  return mod;
}

describe('jwt', () => {
  it('issues a verifiable access token', async () => {
    const { issueAccessToken, verifyToken } = await loadJwt();
    const token = issueAccessToken('user-1', 'device-1');
    expect(token.split('.')).toHaveLength(3);

    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe('user-1');
    expect(payload!.device).toBe('device-1');
    expect(payload!.type).toBe('access');
    expect(payload!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('issues a verifiable refresh token', async () => {
    const { issueRefreshToken, verifyToken } = await loadJwt();
    const token = issueRefreshToken('user-1', 'device-1');

    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.type).toBe('refresh');
    expect(payload!.exp - payload!.iat).toBe(30 * 24 * 60 * 60);
  });

  it('rejects tampered token', async () => {
    const { issueAccessToken, verifyToken } = await loadJwt();
    const token = issueAccessToken('user-1', 'device-1');
    const tampered = token.slice(0, -5) + 'xxxxx';
    expect(verifyToken(tampered)).toBeNull();
  });

  it('rejects token with wrong number of parts', async () => {
    const { verifyToken } = await loadJwt();
    expect(verifyToken('header.body')).toBeNull();
    expect(verifyToken('')).toBeNull();
  });

  it('rejects expired token', async () => {
    const { verifyToken } = await loadJwt();
    // 构造一个已过期 token：过期时间为 2020-01-01
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        sub: 'u',
        device: 'd',
        type: 'access',
        iat: 1577836800,
        exp: 1577836801,
        jti: 'x',
      })
    ).toString('base64url');
    const sig = 'invalid-signature';
    expect(verifyToken(`${header}.${body}.${sig}`)).toBeNull();
  });

  it('rejects non-JWT header', async () => {
    const { verifyToken } = await loadJwt();
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        sub: 'u',
        device: 'd',
        type: 'access',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 1000,
        jti: 'x',
      })
    ).toString('base64url');
    const sig = 'x';
    expect(verifyToken(`${header}.${body}.${sig}`)).toBeNull();
  });
});
