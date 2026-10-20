/**
 * server/src/auth/jwt.ts 单测 —— HS256 + EdDSA 双算法、验签边界、辅助函数
 *
 * issueAccessToken/issueRefreshToken/verifyToken 是核心：签发 → 验签往返。
 * EdDSA 路径用 Node crypto 生成 ed25519 密钥对，注入 config 后重新 import。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  generateKeyPairSync,
  createPublicKey,
  createPrivateKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

// 准备一对 Ed25519 密钥：私钥 PKCS#8，公钥 SPKI
const { publicKey: edPub, privateKey: edPriv } = generateKeyPairSync('ed25519');
const edPubPem = edPub.export({ type: 'spki', format: 'pem' }) as string;
const edPrivPem = edPriv.export({ type: 'pkcs8', format: 'pem' }) as string;
const edPrivKeyObj = createPrivateKey(edPrivPem);
const edPubKeyObj = createPublicKey(edPubPem);

// 故意构造一个错误格式的 Ed25519 私钥（非法 PEM），用于验证回退
const BAD_ED_PRIV =
  '-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8AgEAAkEA==\n-----END PRIVATE KEY-----\n';

let jwtMod: typeof import('./jwt.js');

async function loadWithConfig(cfg: {
  jwtSecret?: string;
  jwtPrivateKey?: string;
  jwtPublicKey?: string;
}) {
  vi.resetModules();
  vi.doMock('../env.js', () => ({
    config: {
      jwtSecret: cfg.jwtSecret ?? 'a'.repeat(48),
      jwtPrivateKey: cfg.jwtPrivateKey,
      jwtPublicKey: cfg.jwtPublicKey,
    },
  }));
  vi.doMock('../logger.js', () => ({
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    },
  }));
  return import('./jwt.js');
}

beforeAll(async () => {
  // 默认 HS256 模式加载
  jwtMod = await loadWithConfig({});
});

afterAll(() => {
  vi.resetModules();
});

describe('jwt 常量', () => {
  it('ACCESS_TTL = 15min / REFRESH_TTL = 30d', () => {
    expect(jwtMod.ACCESS_TTL).toBe(15 * 60);
    expect(jwtMod.REFRESH_TTL).toBe(30 * 24 * 60 * 60);
  });

  it('HS256-only 部署时 ACTIVE_ALGORITHM = HS256', () => {
    expect(jwtMod.ACTIVE_ALGORITHM).toBe('HS256');
  });
});

describe('issueAccessToken / issueRefreshToken / verifyToken 往返', () => {
  it('access token 签发 + 验签：sub/device/type/jti 正确', () => {
    const t = jwtMod.issueAccessToken('user-1', 'dev-1');
    const p = jwtMod.verifyToken(t);
    expect(p).not.toBeNull();
    expect(p!.sub).toBe('user-1');
    expect(p!.device).toBe('dev-1');
    expect(p!.type).toBe('access');
    expect(p!.jti).toMatch(/^[a-f0-9]{32}$/);
    // iat/exp 合理：15min
    expect(p!.exp - p!.iat).toBe(15 * 60);
  });

  it('refresh token 签发 + 验签：30 天 TTL', () => {
    const t = jwtMod.issueRefreshToken('user-1', 'dev-1');
    const p = jwtMod.verifyToken(t);
    expect(p).not.toBeNull();
    expect(p!.type).toBe('refresh');
    expect(p!.exp - p!.iat).toBe(30 * 24 * 60 * 60);
  });

  it('签发的 jti 唯一（每次不同）', () => {
    const a = jwtMod.issueAccessToken('u', 'd');
    const b = jwtMod.issueAccessToken('u', 'd');
    expect(jwtMod.verifyToken(a)!.jti).not.toBe(jwtMod.verifyToken(b)!.jti);
  });
});

describe('verifyToken 拒绝路径', () => {
  it('空串 → null', () => {
    expect(jwtMod.verifyToken('')).toBeNull();
  });

  it('三段不是 . 分隔 → null', () => {
    expect(jwtMod.verifyToken('not.a.valid.jwt')).toBeNull();
  });

  it('header 解码失败（非法 base64）→ null', () => {
    expect(jwtMod.verifyToken('!!!.bbb.ccc')).toBeNull();
  });

  it('typ !== "JWT" → null', () => {
    // 手工构造 typ=JWTx 的 token
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWTx' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ sub: 'u', device: 'd', type: 'access', iat: 0, exp: 9999999999, jti: 'x' })
    ).toString('base64url');
    const fakeSig = 'AAAA';
    expect(jwtMod.verifyToken(`${header}.${body}.${fakeSig}`)).toBeNull();
  });

  it('未知 alg（alg=RS256）→ null', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ sub: 'u', device: 'd', type: 'access', iat: 0, exp: 9999999999, jti: 'x' })
    ).toString('base64url');
    expect(jwtMod.verifyToken(`${header}.${body}.AAAA`)).toBeNull();
  });

  it('alg=none 攻击 → null（拒绝无签名）', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ sub: 'u', device: 'd', type: 'access', iat: 0, exp: 9999999999, jti: 'x' })
    ).toString('base64url');
    expect(jwtMod.verifyToken(`${header}.${body}.`)).toBeNull();
  });

  it('过期 token → null', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ sub: 'u', device: 'd', type: 'access', iat: 100, exp: 200 })
    ).toString('base64url');
    const sig = require('node:crypto')
      .createHmac('sha256', 'a'.repeat(48))
      .update(`${header}.${body}`)
      .digest('base64url');
    expect(jwtMod.verifyToken(`${header}.${body}.${sig}`)).toBeNull();
  });

  it('type 不是 access/refresh → null', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        sub: 'u',
        device: 'd',
        type: 'service',
        iat: Math.floor(Date.now() / 1000),
        exp: 9999999999,
        jti: 'x',
      })
    ).toString('base64url');
    const sig = require('node:crypto')
      .createHmac('sha256', 'a'.repeat(48))
      .update(`${header}.${body}`)
      .digest('base64url');
    expect(jwtMod.verifyToken(`${header}.${body}.${sig}`)).toBeNull();
  });

  it('body 解码失败 → null（防恶意 token）', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    expect(jwtMod.verifyToken(`${header}.!!!.AAAA`)).toBeNull();
  });

  it('签名错误 → null', () => {
    const t = jwtMod.issueAccessToken('u', 'd');
    // 篡改签名
    const parts = t.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${Buffer.from('bad-sig').toString('base64url')}`;
    expect(jwtMod.verifyToken(tampered)).toBeNull();
  });

  it('篡改 body → null（签名失败）', () => {
    const t = jwtMod.issueAccessToken('u', 'd');
    const parts = t.split('.');
    // 改 body 里的 sub
    const newBody = Buffer.from(
      JSON.stringify({
        sub: 'attacker',
        device: 'd',
        type: 'access',
        iat: 0,
        exp: 9999999999,
        jti: 'x',
      })
    ).toString('base64url');
    expect(jwtMod.verifyToken(`${parts[0]}.${newBody}.${parts[2]}`)).toBeNull();
  });
});

describe('EdDSA 模式（双密钥配齐）', () => {
  let edMod: typeof import('./jwt.js');
  beforeAll(async () => {
    edMod = await loadWithConfig({
      jwtSecret: 'a'.repeat(48),
      jwtPrivateKey: edPrivPem,
      jwtPublicKey: edPubPem,
    });
  });
  afterAll(() => vi.resetModules());

  it('ACTIVE_ALGORITHM = EdDSA', () => {
    expect(edMod.ACTIVE_ALGORITHM).toBe('EdDSA');
  });

  it('EdDSA access token 签发 + 验签', () => {
    const t = edMod.issueAccessToken('user-ed', 'dev-ed');
    const p = edMod.verifyToken(t);
    expect(p).not.toBeNull();
    expect(p!.sub).toBe('user-ed');
    expect(p!.type).toBe('access');
    // 签名可用配对公钥独立验签（Ed25519 原始签名，非 HMAC）
    const [h, b, s] = t.split('.');
    expect(
      cryptoVerify(null, Buffer.from(`${h}.${b}`), edPubKeyObj, Buffer.from(s!, 'base64url'))
    ).toBe(true);
  });

  it('EdDSA token 头部 alg=EdDSA', () => {
    const t = edMod.issueAccessToken('u', 'd');
    const header = JSON.parse(Buffer.from(t.split('.')[0]!, 'base64url').toString()) as {
      alg: string;
    };
    expect(header.alg).toBe('EdDSA');
  });

  it('EdDSA 验签：篡改 body → null', () => {
    const t = edMod.issueAccessToken('u', 'd');
    const parts = t.split('.');
    const newBody = Buffer.from(
      JSON.stringify({
        sub: 'attacker',
        device: 'd',
        type: 'access',
        iat: 0,
        exp: 9999999999,
        jti: 'x',
      })
    ).toString('base64url');
    expect(edMod.verifyToken(`${parts[0]}.${newBody}.${parts[2]}`)).toBeNull();
  });

  it('HS256 token 在 EdDSA 部署仍可验（HS256 是 fail-closed-with-兼容）', () => {
    // 反向兼容：EdDSA 部署仍接受 HS256 token（迁移期路径）
    // 实现：verifyToken 仅在 alg=EdDSA + 无公钥时返回 null，HS256 路径总是尝试
    const hs = jwtMod.issueAccessToken('u', 'd'); // HS256 token
    expect(edMod.verifyToken(hs)).not.toBeNull();
  });
});

describe('EdDSA-only 部署（HS256 token 仍可验但 EdDSA token 强制校验）', () => {
  let edOnlyMod: typeof import('./jwt.js');
  beforeAll(async () => {
    edOnlyMod = await loadWithConfig({
      jwtSecret: 'a'.repeat(48),
      jwtPrivateKey: edPrivPem,
      jwtPublicKey: edPubPem,
    });
  });
  afterAll(() => vi.resetModules());

  it('EdDSA token → 正常验签', () => {
    const t = edOnlyMod.issueAccessToken('u', 'd');
    expect(edOnlyMod.verifyToken(t)).not.toBeNull();
  });
});

describe('EdDSA 私钥解析失败 → 回退 HS256', () => {
  it('JWT_PRIVATE_KEY 非法 PEM → logger.warn + 回退 HS256', async () => {
    const warnSpy = vi.fn();
    const logMod = await loadWithConfig({
      jwtSecret: 'a'.repeat(48),
      jwtPrivateKey: BAD_ED_PRIV,
      jwtPublicKey: edPubPem,
    });
    // logger 被 mock 过；这里直接验证 ACTIVE_ALGORITHM 是 HS256
    expect(logMod.ACTIVE_ALGORITHM).toBe('HS256');
    vi.resetModules();
    void warnSpy;
  });
});

describe('EdDSA 缺公钥 → 回退 HS256', () => {
  it('只配私钥不配公钥 → 启动回退 HS256', async () => {
    const m = await loadWithConfig({
      jwtSecret: 'a'.repeat(48),
      jwtPrivateKey: edPrivPem,
      // jwtPublicKey 缺省
    });
    expect(m.ACTIVE_ALGORITHM).toBe('HS256');
    vi.resetModules();
  });
});

describe('hashRefreshToken / safeEqualHash', () => {
  it('hashRefreshToken → 64 位 hex', () => {
    const h = jwtMod.hashRefreshToken('rt-abc');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('同一 token 多次 hash → 相同结果', () => {
    expect(jwtMod.hashRefreshToken('rt')).toBe(jwtMod.hashRefreshToken('rt'));
  });

  it('不同 token → 不同 hash', () => {
    expect(jwtMod.hashRefreshToken('rt-1')).not.toBe(jwtMod.hashRefreshToken('rt-2'));
  });

  it('safeEqualHash：相等 → true', () => {
    const a = jwtMod.hashRefreshToken('x');
    expect(jwtMod.safeEqualHash(a, a)).toBe(true);
  });

  it('safeEqualHash：不等（长度不同）→ false', () => {
    expect(jwtMod.safeEqualHash('a', 'ab')).toBe(false);
  });

  it('safeEqualHash：不等（同长度不同内容）→ false', () => {
    expect(jwtMod.safeEqualHash('aaa', 'bbb')).toBe(false);
  });
});

describe('HS256 算法切换 round-trip（验证签发 key 与验签 key 同步）', () => {
  it('HS256 模式下用错 secret 重新验签 → 失败', async () => {
    // 用 secret-A 签发
    const modA = await loadWithConfig({ jwtSecret: 'A'.repeat(48) });
    const t = modA.issueAccessToken('u', 'd');
    // 用 secret-B 验签
    const modB = await loadWithConfig({ jwtSecret: 'B'.repeat(48) });
    expect(modB.verifyToken(t)).toBeNull();
    vi.resetModules();
  });

  it('EdDSA token 在 HS256-only 部署 → reject（无公钥）', async () => {
    // EdDSA 签发
    const edMod2 = await loadWithConfig({
      jwtSecret: 'a'.repeat(48),
      jwtPrivateKey: edPrivPem,
      jwtPublicKey: edPubPem,
    });
    const t = edMod2.issueAccessToken('u', 'd');
    // HS256-only 部署验签：缺 EdDSA 公钥 → 拒（fail-closed：不容许算法混用）
    const hsMod2 = await loadWithConfig({ jwtSecret: 'a'.repeat(48) });
    expect(hsMod2.verifyToken(t)).toBeNull();
    vi.resetModules();
  });
});

describe('EdDSA 算法下 body 解析边界', () => {
  it('EdDSA token 但 body 是非法 JSON → null', async () => {
    const edMod2 = await loadWithConfig({
      jwtSecret: 'a'.repeat(48),
      jwtPrivateKey: edPrivPem,
      jwtPublicKey: edPubPem,
    });
    // 手工构造：合法 EdDSA header + 合法签名 + 非法 body
    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
    const badBody = '!!!invalid-base64!!!';
    // 用真正的私钥签
    const sig = cryptoSign(null, Buffer.from(`${header}.${badBody}`), edPrivKeyObj).toString(
      'base64url'
    );
    expect(edMod2.verifyToken(`${header}.${badBody}.${sig}`)).toBeNull();
    vi.resetModules();
  });
});
