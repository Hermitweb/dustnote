/**
 * error-reporter 契约测试（P0-4 采集扩端）
 *
 * 锁定与 mobile 端一致的隐私/行为红线：
 * - message 截断 + URL 剥离（token 不落网）
 * - 队列去重与 50 上限
 * - 禁用开关：不入队；关闭清空积压
 * - flush：匿名直连 /diagnostics/reports + X-Client-* 头 + 成功清已发/失败保留
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueDiagEvent,
  getDiagnosticsEnabled,
  setDiagnosticsEnabled,
  flushErrorReports,
} from './error-reporter';

const QUEUE_KEY = 'dustno…s_v1';

interface StoredEvent {
  kind: string;
  message: string;
}

function readQueue(): StoredEvent[] {
  const raw = localStorage.getItem(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as StoredEvent[]) : [];
}

function first(): StoredEvent {
  const e = readQueue()[0];
  if (!e) throw new Error('queue unexpectedly empty');
  return e;
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('error-reporter', () => {
  it('默认开启；禁用后不再入队', () => {
    expect(getDiagnosticsEnabled()).toBe(true);
    setDiagnosticsEnabled(false);
    enqueueDiagEvent('error', 'boom');
    expect(readQueue()).toHaveLength(0);
    setDiagnosticsEnabled(true);
    enqueueDiagEvent('error', 'boom');
    expect(readQueue()).toHaveLength(1);
  });

  it('关闭开关即清空积压队列', () => {
    enqueueDiagEvent('error', 'e1');
    enqueueDiagEvent('error', 'e2');
    expect(readQueue()).toHaveLength(2);
    setDiagnosticsEnabled(false);
    expect(readQueue()).toHaveLength(0);
  });

  it('message 截断 600 且剥离 URL（token 不外发）', () => {
    enqueueDiagEvent(
      'network',
      `GET https://api.x.dev/y?token=SUPERSECRET failed ${'x'.repeat(700)}`
    );
    const m = first().message;
    expect(m.length).toBeLessThanOrEqual(600);
    expect(m).not.toContain('SUPERSECRET');
    expect(m).toContain('[url]');
  });

  it('同 message 去重；超 50 丢最旧', () => {
    for (let i = 0; i < 60; i++) {
      enqueueDiagEvent('error', `unique-${i}`);
    }
    enqueueDiagEvent('error', 'unique-59');
    const q = readQueue();
    expect(q).toHaveLength(50);
    expect(q[49]?.message).toBe('unique-59');
    expect(q.some((e) => e.message === 'unique-0')).toBe(false);
  });

  it('flush 成功清空已发批次并带上平台/版本头', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    enqueueDiagEvent('error', 'net down');
    await flushErrorReports();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as
      | [string, RequestInit & { headers: Record<string, string> }]
      | undefined;
    if (!call) throw new Error('fetch not called');
    const [url, init] = call;
    expect(url).toBe('/api/v1/diagnostics/reports');
    expect(init.headers['X-Client-Platform']).toMatch(/^(web|desktop)$/);
    // 测试环境 define 注入 0.0.0-test，真实构建注入 semver——只断言携带了版本号
    expect(init.headers['X-Client-Version']).toMatch(/^\d+\.\d+\.\d+/);
    expect((init.headers['X-Client-Device-Id'] ?? '').length).toBeGreaterThanOrEqual(8);
    expect(readQueue()).toHaveLength(0);
  });

  it('flush 网络失败保留队列（下次补投）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    enqueueDiagEvent('error', 'keep me');
    await flushErrorReports();
    expect(readQueue()).toHaveLength(1);
  });
});
