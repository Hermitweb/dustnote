/**
 * password-strength 测试
 */
import { describe, it, expect } from 'vitest';
import { evalPasswordStrength, STRENGTH_LABELS, STRENGTH_COLORS } from './password-strength';

describe('evalPasswordStrength', () => {
  it('空密码 → 0', () => {
    expect(evalPasswordStrength('')).toBe(0);
  });

  it('< 6 字符 → 0', () => {
    expect(evalPasswordStrength('A1!b')).toBe(0);
  });

  it('黑名单常见弱密码 → 0', () => {
    expect(evalPasswordStrength('password')).toBe(0);
    expect(evalPasswordStrength('12345678')).toBe(0);
    expect(evalPasswordStrength('qwerty123')).toBe(0);
  });

  it('长度 >= 8 但只有一种字符种类 → 1', () => {
    expect(evalPasswordStrength('aaaaaaaaaaaa')).toBe(1); // 12 chars a all lowercase
  });

  it('长度 >= 8 + 两种种类 → 2', () => {
    expect(evalPasswordStrength('aaaaaaaaAAAA')).toBe(2);
  });

  it('长度 >= 12 + 三种 → 3', () => {
    expect(evalPasswordStrength('aaaaaaaaAAAA1')).toBe(3);
  });

  it('长度 >= 16 + 四种 → 4', () => {
    expect(evalPasswordStrength('aaaaaaaaAAAA1111!')).toBe(4);
  });

  it('STRENGTH_LABELS / STRENGTH_COLORS 各 5 项', () => {
    expect(Object.keys(STRENGTH_LABELS)).toHaveLength(5);
    expect(Object.keys(STRENGTH_COLORS)).toHaveLength(5);
  });
});
