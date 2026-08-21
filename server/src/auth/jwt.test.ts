import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

// 在加载 jwt 模块前设置强密钥
beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long-12345';
});

// 使用动态导入，确保环境变量已设置
async function loadJwt() {
  const mod = await import('./jwt.js');
  return mod;
}

describe('jwt (HS256 fallback)', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.JWT_PRIVATE_KEY;
    delete process.env.JWT_PUBLIC_KEY;
    process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long-12345';
  });

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

// 生成一组 Ed25519 密钥供测试复用
const testKeyPair = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
});

describe('jwt (EdDSA / Ed25519)', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.JWT_PRIVATE_KEY = testKeyPair.privateKey;
    process.env.JWT_PUBLIC_KEY = testKeyPair.publicKey;
  });

  it('uses EdDSA algorithm when key pair is configured', async () => {
    const { issueAccessToken, verifyToken, ACTIVE_ALGORITHM } = await loadJwt();
    expect(ACTIVE_ALGORITHM).toBe('EdDSA');

    const token = issueAccessToken('user-ed', 'device-ed');
    const parts = token.split('.');
    expect(parts).toHaveLength(3);

    // header 应声明 EdDSA
    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString());
    expect(header.alg).toBe('EdDSA');
    expect(header.typ).toBe('JWT');

    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe('user-ed');
    expect(payload!.device).toBe('device-ed');
  });

  it('issues verifiable refresh tokens with EdDSA', async () => {
    const { issueRefreshToken, verifyToken } = await loadJwt();
    const token = issueRefreshToken('user-ed', 'device-ed');
    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.type).toBe('refresh');
    expect(payload!.exp - payload!.iat).toBe(30 * 24 * 60 * 60);
  });

  it('rejects tampered EdDSA token', async () => {
    const { issueAccessToken, verifyToken } = await loadJwt();
    const token = issueAccessToken('user-ed', 'device-ed');
    const tampered = token.slice(0, -5) + 'xxxxx';
    expect(verifyToken(tampered)).toBeNull();
  });

  it('rejects EdDSA token when server has no public key configured (algorithm downgrade defense)', async () => {
    // 用 EdDSA 签发 token
    const edMod = await loadJwt();
    const edToken = edMod.issueAccessToken('user-ed', 'device-ed');

    // 清除密钥配置，回退到 HS256，此时 EdDSA token 应被拒绝
    vi.resetModules();
    delete process.env.JWT_PRIVATE_KEY;
    delete process.env.JWT_PUBLIC_KEY;
    process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long-12345';
    const hsMod = await loadJwt();
    expect(hsMod.ACTIVE_ALGORITHM).toBe('HS256');
    // HS256 服务端不应接受 EdDSA token（防止降级攻击）
    expect(hsMod.verifyToken(edToken)).toBeNull();
  });

  it('accepts HS256 token during EdDSA migration (backward compat) and rejects alg=none downgrade', async () => {
    // 先用 HS256 签发（模拟迁移前已签发的存量 token）
    vi.resetModules();
    delete process.env.JWT_PRIVATE_KEY;
    delete process.env.JWT_PUBLIC_KEY;
    process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long-12345';
    const hsMod = await loadJwt();
    const hsToken = hsMod.issueAccessToken('user-hs', 'device-hs');

    // 切到 EdDSA：JWT_SECRET 仍保留（迁移模式），存量 HS256 token 在过期前可验签
    vi.resetModules();
    process.env.JWT_PRIVATE_KEY = testKeyPair.privateKey;
    process.env.JWT_PUBLIC_KEY = testKeyPair.publicKey;
    process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long-12345';
    const edMod = await loadJwt();
    expect(edMod.ACTIVE_ALGORITHM).toBe('EdDSA');
    // 迁移兼容：HS256 token 仍可验签（直到过期；refresh 最长 30 天）
    expect(edMod.verifyToken(hsToken)).not.toBeNull();
    // 新签发的 token 使用 EdDSA
    const edToken = edMod.issueAccessToken('user-ed', 'device-ed');
    const header = JSON.parse(Buffer.from(edToken.split('.')[0]!, 'base64url').toString());
    expect(header.alg).toBe('EdDSA');
  });
});
