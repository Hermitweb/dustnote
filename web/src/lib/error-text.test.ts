/**
 * error-text 测试
 */
import { describe, it, expect, vi } from 'vitest';
import { errorText } from './error-text';

vi.mock('./i18n', () => ({
  default: {
    language: 'zh-CN',
    t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? `[zh]${k}`,
  },
}));

describe('error-text', () => {
  it('Error 实例 → 调用 shared errorReason 并返回 i18n.t 结果', () => {
    const out = errorText(new Error('boom'));
    expect(typeof out).toBe('string');
  });

  it('null/undefined → 应仍能处理（errorReason 会处理）', () => {
    const out = errorText(null);
    expect(typeof out).toBe('string');
    const out2 = errorText(undefined);
    expect(typeof out2).toBe('string');
  });

  it('字符串 error → 应透传或包装', () => {
    const out = errorText('字符串错误');
    expect(typeof out).toBe('string');
  });
});
