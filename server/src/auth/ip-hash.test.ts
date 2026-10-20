/**
 * IP hash 单元测试
 *
 * 验证：
 *  - 同一 IP 同一时刻产生稳定哈希
 *  - 不同 IP 产生不同哈希
 *  - 缺失 IP / socket 时安全降级（不抛）
 *  - 24h 盐轮换（注入 clock）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request } from 'express';

vi.mock('../env.js', () => ({ config: { jwtSecret: 'unit-test-secret' } }));

const { ipHash } = await import('./ip-hash.js');

function mkReq(ip: string | undefined, socketAddr?: string): Request {
  return {
    ip,
    socket: socketAddr ? { remoteAddress: socketAddr } : undefined,
  } as unknown as Request;
}

describe('ipHash', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('同一 IP → 同一哈希', () => {
    const a = ipHash(mkReq('1.2.3.4'));
    const b = ipHash(mkReq('1.2.3.4'));
    expect(a).toBe(b);
  });

  it('不同 IP → 不同哈希', () => {
    const a = ipHash(mkReq('1.2.3.4'));
    const b = ipHash(mkReq('5.6.7.8'));
    expect(a).not.toBe(b);
  });

  it('缺失 IP 时退回 socket.remoteAddress', () => {
    const a = ipHash(mkReq(undefined, '9.9.9.9'));
    const b = ipHash(mkReq('9.9.9.9'));
    expect(a).toBe(b);
  });

  it('IP 与 socket 都缺失 → 仍返回合法哈希（空字符串输入）', () => {
    const h = ipHash(mkReq(undefined, undefined));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('24h 之后盐轮换 → 同 IP 哈希变化', () => {
    vi.useFakeTimers();
    const start = Date.now();
    vi.setSystemTime(start);
    const before = ipHash(mkReq('1.2.3.4'));
    vi.setSystemTime(start + 24 * 60 * 60 * 1000 + 1000); // 跨过 24h
    const after = ipHash(mkReq('1.2.3.4'));
    expect(before).not.toBe(after);
  });
});
