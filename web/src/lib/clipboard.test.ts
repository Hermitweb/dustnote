/**
 * clipboard.ts 单元测试
 *
 * 重点：HTTP 直连（navigator.clipboard 为 undefined）场景下
 * copyText 不抛异常，走 execCommand 降级（历史 bug：v2.5.10）。
 * 注意 jsdom 未实现 document.execCommand，需先注入桩。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyText } from './clipboard';

function stubExecCommand(impl: (cmd: string) => boolean) {
  Object.defineProperty(document, 'execCommand', {
    value: impl,
    configurable: true,
    writable: true,
  });
}

describe('copyText', () => {
  beforeEach(() => {
    // jsdom 无 execCommand 实现，注入可追踪桩
    stubExecCommand(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    // 恢复 jsdom 原状（无 execCommand）
    Object.defineProperty(document, 'execCommand', {
      value: undefined,
      configurable: true,
    });
    // 还原 navigator.clipboard（jsdom 默认无）
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
  });

  it('HTTP 环境（无 navigator.clipboard）：走 execCommand 降级且不抛异常', async () => {
    const spy = vi.fn(() => true);
    stubExecCommand(spy);
    const ok = await copyText('hello-http');
    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('copy');
  });

  it('降级路径抛异常时返回 false 而非 reject', async () => {
    stubExecCommand(() => {
      throw new Error('execCommand unavailable');
    });
    const ok = await copyText('will-fail');
    expect(ok).toBe(false);
  });

  it('安全上下文：优先使用 Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const spy = vi.fn(() => true);
    stubExecCommand(spy);
    const ok = await copyText('via-api');
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('via-api');
    expect(spy).not.toHaveBeenCalled();
  });

  it('Clipboard API 失败时回退 execCommand', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const spy = vi.fn(() => true);
    stubExecCommand(spy);
    const ok = await copyText('fallback');
    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('copy');
  });
});
