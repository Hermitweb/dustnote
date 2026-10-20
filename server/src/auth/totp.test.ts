/**
 * TOTP (RFC 6238) 单测
 *
 * 覆盖：
 *  - generateTotpSecret 输出 32 字符 base32
 *  - generateTotpUri 格式合规
 *  - generateTotp / verifyTotp 完整往返
 *  - verifyTotpWithCounter 防重放
 *  - 时钟漂移 ±30s 仍然通过
 *  - 错误 token / 空 token / 长度不一致都被拒
 */
import { describe, it, expect } from 'vitest';
import {
  generateTotpSecret,
  generateTotpUri,
  generateTotp,
  verifyTotp,
  verifyTotpWithCounter,
} from './totp.js';

describe('TOTP - secret / uri', () => {
  it('generateTotpSecret 返回 32 字符 base32（20 字节 → 32 字符）', () => {
    const s = generateTotpSecret();
    expect(s).toHaveLength(32);
    expect(s).toMatch(/^[A-Z2-7]+$/);
  });

  it('generateTotpSecret 两次调用结果不同（随机）', () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).not.toBe(b);
  });

  it('generateTotpUri 格式正确', () => {
    const uri = generateTotpUri('ABCDEFGH', 'user@example.com');
    expect(uri).toMatch(/^otpauth:\/\/totp\/DustNote:user%40example\.com\?/);
    expect(uri).toContain('secret=ABCDEFGH');
    expect(uri).toContain('issuer=DustNote');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('generateTotpUri 对 issuer 中的特殊字符做 percent-encoding', () => {
    const uri = generateTotpUri('SECRET', 'a@b');
    expect(uri).toContain('a%40b');
  });
});

describe('TOTP - round trip', () => {
  it('generateTotp 与 verifyTotp 一致', () => {
    const secret = generateTotpSecret();
    const token = generateTotp(secret);
    expect(verifyTotp(token, secret)).toBe(true);
  });

  it('错误 token → false', () => {
    const secret = generateTotpSecret();
    const token = generateTotp(secret);
    const tampered = token === '000000' ? '111111' : '000000';
    expect(verifyTotp(tampered, secret)).toBe(false);
  });

  it('空 token → false', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp('', secret)).toBe(false);
  });

  it('长度不一致的 token → false', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp('12345', secret)).toBe(false); // 5 位
    expect(verifyTotp('1234567', secret)).toBe(false); // 7 位
  });
});

describe('TOTP - 时钟偏移容忍', () => {
  it('向前 1 个窗口（+30s）仍然可验证', () => {
    const secret = generateTotpSecret();
    const nowSec = Math.floor(Date.now() / 1000);
    // generateTotp 第二参数是「秒」语义下的时间戳（不是毫秒）
    const futureSec = nowSec + 30;
    const futureToken = generateTotp(secret, futureSec);
    expect(verifyTotp(futureToken, secret)).toBe(true);
  });

  it('向前 2 个窗口（+60s）应被拒（超出 ±30s 容忍）', () => {
    const secret = generateTotpSecret();
    const nowSec = Math.floor(Date.now() / 1000);
    const futureSec = nowSec + 90;
    const futureToken = generateTotp(secret, futureSec);
    expect(verifyTotp(futureToken, secret)).toBe(false);
  });
});

describe('TOTP - 防重放（verifyTotpWithCounter）', () => {
  it('lastUsedCounter >= 当前窗口 → 拒绝', () => {
    const secret = generateTotpSecret();
    const now = Math.floor(Date.now() / 1000);
    const counter = Math.floor(now / 30);
    const token = generateTotp(secret);
    expect(verifyTotpWithCounter(token, secret, counter).ok).toBe(false);
  });

  it('成功后返回的 counter 可被下次调用用作 lastUsed', () => {
    const secret = generateTotpSecret();
    // 用过去 1 个窗口（-30s）生成 token —— 仍落在 verify ±30s 容忍内
    const nowSec = Math.floor(Date.now() / 1000);
    const pastSec = nowSec - 30;
    const token = generateTotp(secret, pastSec);
    const baseCounter = Math.floor(pastSec / 30);
    const r1 = verifyTotpWithCounter(token, secret, baseCounter - 1);
    expect(r1.ok).toBe(true);
    // 用同一 token + r1.counter 重放 → 应失败（防重放）
    const r2 = verifyTotpWithCounter(token, secret, r1.counter);
    expect(r2.ok).toBe(false);
  });

  it('失败时 counter 返回 -1', () => {
    const secret = generateTotpSecret();
    const r = verifyTotpWithCounter('000000', secret, -1);
    expect(r.ok).toBe(false);
    expect(r.counter).toBe(-1);
  });
});
