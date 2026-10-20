/**
 * web/src/lib/argon2-worker.ts 单测
 *
 * 该模块在 import 时即赋值 self.onmessage。用例直接取 self.onmessage 调用：
 * - 成功：postMessage({id, result:{kek, authKey}})
 * - 失败：postMessage({id, error})
 * 覆盖 L27-46（worker 消息协议主体）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KDF_PARAMS } from '@dustnote/shared';

// 动态 import worker 模块，触发 self.onmessage 赋值
// （只需副作用，模块本身不导出可用值，故不保留返回值）
await import('./argon2-worker');

/**
 * 触发 self.onmessage，收集 postMessage 调用（postMessage spy 在 window 上）
 *
 * worker 的 onmessage 是 async（返回 Promise<void>），这里放宽成 void | Promise<void>
 * 以便同步/异步处理器都能传进来。
 */
async function fire(
  onmsg: (e: MessageEvent) => void | Promise<void>,
  data: unknown
): Promise<void> {
  const ev = new MessageEvent('message', { data });
  await onmsg(ev);
}

describe('argon2-worker.onmessage 协议', () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessageSpy = vi.fn();
    // jsdom 下 self === window，patch postMessage 收集调用
    (globalThis as any).postMessage = postMessageSpy;
    // 每次重新 import 前 onmessage 已在模块加载时设好；这里直接读当前引用
  });

  it('正常请求 → postMessage({id, result:{kek, authKey}})', async () => {
    const onmsg = (globalThis as any).onmessage;
    expect(typeof onmsg).toBe('function');
    await fire(onmsg, { id: 7, secret: 'pw', salt: [1, 2, 3, 4], params: KDF_PARAMS });
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    const resp = postMessageSpy.mock.calls[0]![0];
    expect(resp.id).toBe(7);
    expect(Array.isArray(resp.result.kek)).toBe(true);
    expect(resp.result.kek.length).toBeGreaterThan(0);
    expect(resp.error).toBeUndefined();
  });

  it('省略 params → 用 KDF_PARAMS 默认', async () => {
    const onmsg = (globalThis as any).onmessage;
    await fire(onmsg, { id: 8, secret: 'pw', salt: [9, 9, 9, 9] });
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    const resp = postMessageSpy.mock.calls[0]![0];
    expect(resp.id).toBe(8);
    expect(resp.result).toBeTruthy();
  });

  it('deriveSecrets 抛错 → postMessage({id, error})', async () => {
    // 用非法 salt（空数组之外的异常路径）：传 undefined salt 让 new Uint8Array 抛
    const onmsg = (globalThis as any).onmessage;
    await fire(onmsg, { id: 9, secret: 'pw', salt: undefined });
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    const resp = postMessageSpy.mock.calls[0]![0];
    expect(resp.id).toBe(9);
    expect(typeof resp.error).toBe('string');
    expect(resp.result).toBeUndefined();
  });
});
