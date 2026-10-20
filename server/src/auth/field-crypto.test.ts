/**
 * 字段级加密（field-crypto.ts）单元测试
 *
 * 验证：
 *  - encryptField 产生 enc:v1: 前缀
 *  - decryptField 正确还原密文
 *  - decryptField 对历史明文（无前缀）原样返回（向后兼容）
 *  - isEncryptedField 正确识别
 *  - 篡改密文 / tag 都会被 GCM 拒绝（auth failure → throw）
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../env.js', () => ({ config: { jwtSecret: 'unit-test-jwt-secret-32+chars' } }));

const { encryptField, decryptField, isEncryptedField } = await import('./field-crypto.js');

describe('field-crypto', () => {
  it('encryptField 输出以 enc:v1: 开头', () => {
    const ct = encryptField('hello');
    expect(ct.startsWith('enc:v1:')).toBe(true);
  });

  it('decryptField 还原原始明文', () => {
    const ct = encryptField('hello world');
    expect(decryptField(ct)).toBe('hello world');
  });

  it('两次加密同一明文 → 不同密文（IV 随机）', () => {
    const a = encryptField('same');
    const b = encryptField('same');
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe('same');
    expect(decryptField(b)).toBe('same');
  });

  it('decryptField 对历史明文原样返回（向后兼容）', () => {
    expect(decryptField('plain-old-secret')).toBe('plain-old-secret');
    expect(decryptField('')).toBe('');
  });

  it('decryptField 对格式错误的 enc:v1 字符串原样返回（防止数据回退为 500）', () => {
    expect(decryptField('enc:v1:not-real-format')).toBe('enc:v1:not-real-format');
    expect(decryptField('enc:v1:only:two')).toBe('enc:v1:only:two');
  });

  it('isEncryptedField 正确识别', () => {
    expect(isEncryptedField('enc:v1:abc:def:ghi')).toBe(true);
    expect(isEncryptedField('plain')).toBe(false);
    expect(isEncryptedField(null)).toBe(false);
    expect(isEncryptedField(undefined)).toBe(false);
    expect(isEncryptedField('')).toBe(false);
  });

  it('篡改密文 → GCM auth tag 校验失败 → throw', () => {
    const ct = encryptField('secret');
    const parts = ct.split(':');
    // parts 形如 ['enc','v1','<iv>','<tag>','<ct>']
    // 把 ct 段最后字符翻转
    const lastChar = parts[4]!.slice(-1);
    const flip = lastChar === 'A' ? 'B' : 'A';
    const tampered = parts.slice(0, 4).join(':') + ':' + parts[4]!.slice(0, -1) + flip;
    expect(() => decryptField(tampered)).toThrow();
  });

  it('篡改 tag → throw', () => {
    // tag 是 base64url：字符集 [A-Za-z0-9-_]，但 AES-GCM 的 tag 是 16 字节二进制
    // base64url 编码后未必以 A/B 结尾，所以直接替换中间一个字符（且仍在合法 base64url 集内）
    const ct = encryptField('secret');
    const parts = ct.split(':');
    const tag = parts[3]!;
    // 替换第 4 个字符（必定存在），使其异于原值
    const i = Math.min(4, tag.length - 1);
    const origChar = tag[i];
    const replacement =
      origChar === 'A' ? 'B' : origChar === 'a' ? 'b' : origChar === '0' ? '1' : 'A';
    const tamperedTag = tag.slice(0, i) + replacement + tag.slice(i + 1);
    const tampered =
      parts[0] + ':' + parts[1] + ':' + parts[2] + ':' + tamperedTag + ':' + parts[4];
    expect(() => decryptField(tampered)).toThrow();
  });
});
