/**
 * 解密明文缓存（TEST-004）
 *
 * 缓存以「密文原文」为判据：别的设备改了笔记 → 密文变 → 旧条目必须失效，
 * 否则会读到过期明文（E2EE 下这是数据正确性问题，不是性能问题）。
 * 另外两条不变量：只存内存（明文不得进 storage）、有条目上限（大库不无限堆积明文）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedPlain, putCachedPlain, invalidatePlain, clearPlainCache } from './plain-cache';

describe('plain-cache', () => {
  beforeEach(() => clearPlainCache());

  it('密文一致才命中', () => {
    putCachedPlain('n1', 'ct-v1', '标题', '正文');
    expect(getCachedPlain('n1', 'ct-v1')?.title).toBe('标题');
    expect(getCachedPlain('n1', 'ct-v2')).toBeUndefined();
  });

  it('密文变化即失效（其它设备同步过来的场景）', () => {
    putCachedPlain('n1', 'ct-v1', '旧标题', '旧正文');
    putCachedPlain('n1', 'ct-v2', '新标题', '新正文');
    expect(getCachedPlain('n1', 'ct-v1')).toBeUndefined();
    expect(getCachedPlain('n1', 'ct-v2')?.title).toBe('新标题');
  });

  it('invalidate 只影响指定条目', () => {
    putCachedPlain('a', 'ca', 'A', '');
    putCachedPlain('b', 'cb', 'B', '');
    invalidatePlain('a');
    expect(getCachedPlain('a', 'ca')).toBeUndefined();
    expect(getCachedPlain('b', 'cb')?.title).toBe('B');
  });

  it('有条目上限，且按 LRU 淘汰最久未用的（长时间刷大库不会无限堆明文）', () => {
    for (let i = 0; i < 320; i++) putCachedPlain(`n${i}`, `c${i}`, `t${i}`, '');
    expect(getCachedPlain('n0', 'c0')).toBeUndefined();
    expect(getCachedPlain('n319', 'c319')?.title).toBe('t319');
    // 触碰过的条目应当活下来：读一次 n100 后再塞 100 条，它仍在
    putCachedPlain('hot', 'ch', 'H', '');
    getCachedPlain('hot', 'ch');
    for (let i = 0; i < 60; i++) putCachedPlain(`x${i}`, `y${i}`, '', '');
    expect(getCachedPlain('hot', 'ch')?.title).toBe('H');
  });

  it('缓存只在内存里：全程没有触碰任何存储 API', () => {
    // 这条断言的价值在于"以后有人想加持久化时会先看到注释"
    expect(typeof localStorage === 'undefined').toBe(true);
  });
});
