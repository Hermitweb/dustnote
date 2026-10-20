/**
 * web/src/screens/PublicShareView.tsx 单测 —— readShareKey（直接测真函数）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { toBase64Url } from '@dustnote/shared';
import { readShareKey } from './PublicShareView.js';

describe('PublicShareView.readShareKey', () => {
  const originalHash = location.hash;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, hash: '' },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, hash: originalHash },
      configurable: true,
      writable: true,
    });
  });

  it('空 hash → null', () => {
    location.hash = '';
    expect(readShareKey()).toBeNull();
  });

  it('仅 # → null（剥前缀后空串）', () => {
    location.hash = '#';
    expect(readShareKey()).toBeNull();
  });

  it('空格 hash → null（trim 后空）', () => {
    location.hash = '#   ';
    expect(readShareKey()).toBeNull();
  });

  it('合法 32 字节 base64url → 返回 Uint8Array(32) 且内容一致', () => {
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);
    location.hash = `#${toBase64Url(key)}`;
    const got = readShareKey();
    expect(got).not.toBeNull();
    expect(got!.length).toBe(32);
    expect(Array.from(got!)).toEqual(Array.from(key));
  });

  it('非法 base64 → null（catch 兜底）', () => {
    location.hash = '#!!!not-base64!!!';
    expect(readShareKey()).toBeNull();
  });

  it('长度不是 32 字节 → null', () => {
    // 16 字节 = base64url 22 字符
    const short = new Uint8Array(16);
    location.hash = `#${toBase64Url(short)}`;
    expect(readShareKey()).toBeNull();
  });

  it('长度 64 字节 → null', () => {
    const long = new Uint8Array(64);
    location.hash = `#${toBase64Url(long)}`;
    expect(readShareKey()).toBeNull();
  });
});
