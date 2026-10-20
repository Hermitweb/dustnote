/**
 * platform.ts 测试
 */
import { describe, it, expect } from 'vitest';
import { isTauri, isProduction } from './platform';

describe('platform', () => {
  it('isTauri: 无 __TAURI_INTERNALS__ → false', () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    expect(isTauri()).toBe(false);
  });

  it('isTauri: 有 __TAURI_INTERNALS__ → true', () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    expect(isTauri()).toBe(true);
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('isProduction: 返回 import.meta.env.PROD', () => {
    // 测试环境 import.meta.env.PROD 是 false
    expect(isProduction()).toBe(false);
  });
});
