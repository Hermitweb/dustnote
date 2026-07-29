import { describe, it, expect } from 'vitest';
import {
  deriveSecrets,
  generateMasterKey,
  generateRecoveryCode,
  normalizeRecoveryCode,
  isValidRecoveryCode,
  encrypt,
  decrypt,
  encryptString,
  decryptString,
  wrapKey,
  unwrapKey,
  isCiphertext,
  toBase64Url,
  fromBase64Url,
  randomBytes,
  KDF_PARAMS,
} from '../src/crypto';

/**
 * 测试用的弱 KDF 参数。
 *
 * 生产参数是 Argon2id m=64MB/t=3/p=4，纯 JS 实现下每次约 2 秒——一条走完
 * setup→recover 的用例要派生 4 次，光它就会超掉 vitest 的默认超时。
 * 协议逻辑与 KDF 强度无关，所以绝大多数用例用弱参数跑；
 * 生产参数本身由 `uses OWASP-recommended parameters` 和末尾那条慢用例守住。
 */
const FAST_KDF = { m: 64, t: 1, p: 1, dkLen: 32 };

describe('crypto', () => {
  const password = 'correct-horse-battery-staple';
  const salt = crypto.getRandomValues(new Uint8Array(16));

  it('derives the same secrets from the same password and salt', async () => {
    const s1 = await deriveSecrets(password, salt, FAST_KDF);
    const s2 = await deriveSecrets(password, salt, FAST_KDF);
    expect(s1.kek).toEqual(s2.kek);
    expect(s1.authKey).toEqual(s2.authKey);
    expect(s1.kek.length).toBe(32);
    expect(s1.authKey.length).toBe(32);
  });

  it('derives different secrets for different passwords', async () => {
    const s1 = await deriveSecrets(password, salt, FAST_KDF);
    const s2 = await deriveSecrets('another-password', salt, FAST_KDF);
    expect(s1.kek).not.toEqual(s2.kek);
    expect(s1.authKey).not.toEqual(s2.authKey);
  });

  it('keeps kek and authKey independent, so leaking authKey does not expose the kek', async () => {
    const { kek, authKey } = await deriveSecrets(password, salt, FAST_KDF);
    expect(kek).not.toEqual(authKey);
  });

  it('encrypts and decrypts bytes', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = new TextEncoder().encode('hello dustnote');
    const blob = await encrypt(key, plaintext);
    expect(blob.v).toBe(1);
    expect(blob.k).toBe(1);
    expect(typeof blob.n).toBe('string');
    expect(typeof blob.c).toBe('string');

    const decrypted = await decrypt(key, blob);
    expect(new TextDecoder().decode(decrypted)).toBe('hello dustnote');
  });

  it('encrypts and decrypts strings', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const blob = await encryptString(key, '尘心笔记');
    const decrypted = await decryptString(key, blob);
    expect(decrypted).toBe('尘心笔记');
  });

  it('wraps and unwraps the master key with a derived kek', async () => {
    const masterKey = generateMasterKey();
    const { kek } = await deriveSecrets(password, salt, FAST_KDF);
    const wrapped = await wrapKey(kek, masterKey);
    expect(isCiphertext(wrapped)).toBe(true);

    expect(await unwrapKey(kek, wrapped)).toEqual(masterKey);
  });

  it('fails to unwrap with the wrong kek', async () => {
    const masterKey = generateMasterKey();
    const right = await deriveSecrets(password, salt, FAST_KDF);
    const wrong = await deriveSecrets('wrong-password', salt, FAST_KDF);
    const wrapped = await wrapKey(right.kek, masterKey);
    await expect(unwrapKey(wrong.kek, wrapped)).rejects.toThrow();
  });

  it('detects invalid ciphertext shape', () => {
    expect(isCiphertext({ v: 1, k: 1, n: 'abc', c: 'def' })).toBe(true);
    expect(isCiphertext({ v: 1, k: 1, n: 'abc' })).toBe(false);
    expect(isCiphertext(null)).toBe(false);
    expect(isCiphertext('string')).toBe(false);
  });
});

describe('recovery code', () => {
  it('generates a 10-char Crockford code formatted in two groups', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(normalizeRecoveryCode(code)).toHaveLength(10);
    expect(isValidRecoveryCode(code)).toBe(true);
  });

  it('generates distinct codes', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(50);
  });

  it('normalizes separators, case, and Crockford look-alikes', () => {
    expect(normalizeRecoveryCode('a7k2m-9pqr3')).toBe('A7K2M9PQR3');
    expect(normalizeRecoveryCode('A7K2M 9PQR3')).toBe('A7K2M9PQR3');
    // O→0, I/L→1 是 Crockford 约定，用户抄错字形也能解开
    expect(normalizeRecoveryCode('O7K2M-9PQR3')).toBe('07K2M9PQR3');
    expect(normalizeRecoveryCode('I7K2M-9PQRL')).toBe('17K2M9PQR1');
  });

  it('rejects codes of the wrong length', () => {
    expect(isValidRecoveryCode('A7K2M')).toBe(false);
    expect(isValidRecoveryCode('A7K2M-9PQR3X')).toBe(false);
    expect(isValidRecoveryCode('')).toBe(false);
  });

  it('derives the same secrets whether the user types the dash or not', async () => {
    const rcSalt = crypto.getRandomValues(new Uint8Array(16));
    const code = generateRecoveryCode();
    const a = await deriveSecrets(normalizeRecoveryCode(code), rcSalt, FAST_KDF);
    const b = await deriveSecrets(
      normalizeRecoveryCode(code.replace('-', '').toLowerCase()),
      rcSalt,
      FAST_KDF
    );
    expect(a.kek).toEqual(b.kek);
  });
});

describe('base64url', () => {
  it('round-trips arbitrary bytes, including lengths that need padding', () => {
    for (const len of [1, 2, 3, 16, 31, 32, 33]) {
      const bytes = randomBytes(len);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });

  it('produces URL-safe output with no padding', () => {
    for (let i = 0; i < 20; i++) {
      expect(toBase64Url(randomBytes(32))).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

/**
 * 分享的 secret-link 方案：服务端只拿到密文，shareKey 走 URL fragment。
 */
describe('secret-link share', () => {
  it('decrypts only with the key carried in the link fragment', async () => {
    const masterKey = generateMasterKey();
    const shareKey = randomBytes(32);
    const payload = { title: '公开笔记', content: '# 标题\n正文' };

    // 主人侧：用 shareKey 加密内容，再用 masterKey 包一份 shareKey
    const ciphertext = await encryptString(shareKey, JSON.stringify(payload));
    const wrappedShareKey = await wrapKey(masterKey, shareKey);
    const fragment = toBase64Url(shareKey);

    // 访客侧：只有 token（拿到 ciphertext）+ fragment 里的 shareKey
    const visitorKey = fromBase64Url(fragment);
    expect(JSON.parse(await decryptString(visitorKey, ciphertext))).toEqual(payload);

    // 服务端侧：只有 ciphertext 和 wrappedShareKey，两者都解不开
    await expect(decryptString(randomBytes(32), ciphertext)).rejects.toThrow();
    await expect(unwrapKey(randomBytes(32), wrappedShareKey)).rejects.toThrow();

    // 主人换设备：用 masterKey 解封 shareKey，还原出同一个 fragment
    expect(toBase64Url(await unwrapKey(masterKey, wrappedShareKey))).toBe(fragment);
  });
});

/**
 * 认证协议 v2 的端到端回归。
 *
 * v1 在这条链路上是断的：masterKey 由密码派生，恢复时用新密码又派生出一把
 * 全新的 masterKey，历史笔记就此永久解不开。下面第三个用例正是为了钉死这点。
 */
describe('auth protocol v2 round-trip', () => {
  async function setupAccount(password: string) {
    const masterKey = generateMasterKey();
    const recoveryCode = generateRecoveryCode();
    const pwSalt = crypto.getRandomValues(new Uint8Array(16));
    const rcSalt = crypto.getRandomValues(new Uint8Array(16));

    const pw = await deriveSecrets(password, pwSalt, FAST_KDF);
    const rc = await deriveSecrets(normalizeRecoveryCode(recoveryCode), rcSalt, FAST_KDF);

    return {
      masterKey,
      recoveryCode,
      pwSalt,
      rcSalt,
      // 服务端存的东西：两份包装密文 + 两个 authKey（实际还会再哈希一层）
      stored: {
        wrappedPw: await wrapKey(pw.kek, masterKey),
        wrappedRc: await wrapKey(rc.kek, masterKey),
        authKey: pw.authKey,
        recoveryAuthKey: rc.authKey,
      },
    };
  }

  it('unlocks with the password and recovers the same master key', async () => {
    const account = await setupAccount('my-master-password');

    // 另一台设备：只有密码和服务端下发的 pwSalt
    const pw = await deriveSecrets('my-master-password', account.pwSalt, FAST_KDF);
    expect(pw.authKey).toEqual(account.stored.authKey);
    expect(await unwrapKey(pw.kek, account.stored.wrappedPw)).toEqual(account.masterKey);
  });

  it('rejects a wrong password before any key material is exposed', async () => {
    const account = await setupAccount('my-master-password');
    const wrong = await deriveSecrets('not-my-password', account.pwSalt, FAST_KDF);
    expect(wrong.authKey).not.toEqual(account.stored.authKey);
    await expect(unwrapKey(wrong.kek, account.stored.wrappedPw)).rejects.toThrow();
  });

  it('keeps existing notes readable after recovering with a new password', async () => {
    const account = await setupAccount('forgotten-password');

    // 用旧 masterKey 加密一条笔记
    const note = await encryptString(account.masterKey, '恢复前写的笔记');

    // 走恢复流程：用恢复码解封出**原来那把** masterKey
    const rc = await deriveSecrets(
      normalizeRecoveryCode(account.recoveryCode),
      account.rcSalt,
      FAST_KDF
    );
    expect(rc.authKey).toEqual(account.stored.recoveryAuthKey);
    const recovered = await unwrapKey(rc.kek, account.stored.wrappedRc);
    expect(recovered).toEqual(account.masterKey);

    // 设置新密码 = 用新 KEK 重新包装同一把 masterKey
    const newPwSalt = crypto.getRandomValues(new Uint8Array(16));
    const newPw = await deriveSecrets('brand-new-password', newPwSalt, FAST_KDF);
    const rewrapped = await wrapKey(newPw.kek, recovered);

    // 新密码解锁后，恢复前写的笔记依然解得开——这正是 v1 丢数据的地方
    const afterUnlock = await unwrapKey(newPw.kek, rewrapped);
    expect(await decryptString(afterUnlock, note)).toBe('恢复前写的笔记');
  });

  it('never lets the server-held material reveal the master key', async () => {
    const account = await setupAccount('my-master-password');
    // 服务端持有的 authKey 不能用来解封任何一份包装
    await expect(unwrapKey(account.stored.authKey, account.stored.wrappedPw)).rejects.toThrow();
    await expect(
      unwrapKey(account.stored.recoveryAuthKey, account.stored.wrappedRc)
    ).rejects.toThrow();
  });
});

describe('production KDF parameters', () => {
  it('uses OWASP-recommended parameters', () => {
    // 上面的用例都跑弱参数，这里确保发布出去的仍是 OWASP 2024 推荐值
    expect(KDF_PARAMS).toEqual({ m: 64 * 1024, t: 3, p: 4, dkLen: 32 });
  });

  it('completes a full unlock round-trip at production strength', async () => {
    // 唯一一条按真实参数跑的用例：确认生产配置下密钥派生是自洽的。
    // 两次 Argon2id @64MB 在纯 JS 下大约要几秒，所以单独放宽超时。
    const masterKey = generateMasterKey();
    const pwSalt = randomBytes(16);

    const setup = await deriveSecrets('production-strength-password', pwSalt);
    const wrapped = await wrapKey(setup.kek, masterKey);

    const unlock = await deriveSecrets('production-strength-password', pwSalt);
    expect(unlock.authKey).toEqual(setup.authKey);
    expect(await unwrapKey(unlock.kek, wrapped)).toEqual(masterKey);
  }, 30_000);
});
