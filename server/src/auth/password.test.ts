/**
 * password 单元测试补齐
 *
 * 已有 password.test.ts 覆盖 4 个用例；本测试补齐：
 *  - verifyPassword 旧格式（无前缀）的兼容路径
 *  - verifyPassword 非法格式（参数错误、长度错误）返回 false
 *  - verifyPassword 错误口令返回 false
 */
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password / 旧格式兼容', () => {
  it('旧格式（无前缀）→ 验证通过', async () => {
    // 模拟旧 DB 中存的格式：salt(16B) + hash(32B) base64url 拼接
    const { scrypt, randomBytes } = await import('node:crypto');
    const password = 'legacy-pwd';
    const salt = randomBytes(16);
    const hash = await new Promise<Buffer>((r, j) =>
      scrypt(password, salt, 32, { N: 1 << 14 }, (e, k) => (e ? j(e) : r(k)))
    );
    const stored = Buffer.concat([salt, hash]).toString('base64url');
    expect(await verifyPassword(password, stored)).toBe(true);
    expect(await verifyPassword('wrong', stored)).toBe(false);
  });

  it('旧格式长度错误（不是 48B）→ false', async () => {
    expect(await verifyPassword('any', Buffer.from('short').toString('base64url'))).toBe(false);
  });
});

describe('password / 新格式边界', () => {
  it('segments 数量不对 → false', async () => {
    expect(await verifyPassword('any', 'scrypt$1$2$3$salt$hash$extra')).toBe(false);
  });

  it('参数非整数 → false', async () => {
    expect(await verifyPassword('any', 'scrypt$abc$2$1$YWFh$YWFh')).toBe(false);
  });

  it('参数过小（N<2 / r<1 / p<1）→ false', async () => {
    expect(await verifyPassword('any', 'scrypt$1$0$1$YWFh$YWFhYWFh')).toBe(false);
    expect(await verifyPassword('any', 'scrypt$2$0$1$YWFh$YWFhYWFh')).toBe(false);
    expect(await verifyPassword('any', 'scrypt$2$2$0$YWFh$YWFhYWFh')).toBe(false);
  });

  it('salt / hash 长度不对 → false', async () => {
    // valid N,r,p 但 salt 太短
    expect(await verifyPassword('any', 'scrypt$131072$8$1$YWJj$YWFh')).toBe(false);
  });

  it('hashPassword 两次结果不同（盐随机）', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  it('hashPassword 输出符合 scrypt$... 格式', async () => {
    const h = await hashPassword('test');
    const parts = h.split('$');
    expect(parts.length).toBe(6);
    expect(parts[0]).toBe('scrypt');
    expect(parts[1]).toBe('131072');
    expect(parts[2]).toBe('8');
    expect(parts[3]).toBe('1');
  });
});

describe('password / 错误处理', () => {
  it('错误的口令 → false', async () => {
    const h = await hashPassword('correct-password');
    expect(await verifyPassword('wrong-password', h)).toBe(false);
  });

  it('空字符串口令 → hash 仍然成功', async () => {
    const h = await hashPassword('');
    expect(await verifyPassword('', h)).toBe(true);
    expect(await verifyPassword('x', h)).toBe(false);
  });

  it('异常格式 → false（不抛）', async () => {
    expect(await verifyPassword('any', 'not-base64-!@#$%')).toBe(false);
  });
});
