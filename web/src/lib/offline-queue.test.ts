/**
 * offline-queue 单元测试
 *
 * v2.5.5：实现已委托 @dustnote/client-core（OfflineQueue + IndexedDbQueueStorage）。
 * jsdom 不实现 IndexedDB，因此用 vi.mock 把 IndexedDbQueueStorage 替换为
 * client-core 自带的 MemoryQueueStorage（继承并记录 save 快照），
 * 队列语义（enqueue/peek/remove/退避/清空）仍测真实实现。
 * 覆盖：
 * - enqueue 顺序与返回值
 * - peek / peekAll / size
 * - remove / bumpRetries（超阈值移除）
 * - clear
 * - persist：入队后确实调用了底层存储 save（快照验证）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedOp } from '@dustnote/client-core';

// 每次 save 调用的队列快照（验证持久化语义）
const { saveSnapshots } = vi.hoisted(() => ({
  saveSnapshots: [] as QueuedOp[][],
}));

vi.mock('@dustnote/client-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dustnote/client-core')>();
  // 内存后端：替换 IndexedDB，同时记录 save 快照
  class TestQueueStorage extends actual.MemoryQueueStorage {
    override async save(ops: QueuedOp[]): Promise<void> {
      saveSnapshots.push([...ops]);
      await super.save(ops);
    }
  }
  return { ...actual, IndexedDbQueueStorage: TestQueueStorage };
});

// 动态导入以让 vi.mock 生效
const { enqueue, peek, peekAll, remove, bumpRetries, clear, size, MAX_RETRIES, getRetryDelay } =
  await import('./offline-queue');

describe('offline-queue', () => {
  beforeEach(async () => {
    saveSnapshots.length = 0;
    await clear();
  });

  it('enqueue adds op to the queue and returns it with id/createdAt', async () => {
    const op = await enqueue({ method: 'PATCH', path: '/notes/1', body: { x: 1 }, noteId: '1' });
    expect(op.id).toBeTruthy();
    expect(op.method).toBe('PATCH');
    expect(op.path).toBe('/notes/1');
    expect(op.retries).toBe(0);
    expect(op.createdAt).toBeTruthy();
  });

  it('maintains FIFO order', async () => {
    await enqueue({ method: 'POST', path: '/notes', noteId: 'a' });
    await enqueue({ method: 'PATCH', path: '/notes/b', noteId: 'b' });
    await enqueue({ method: 'DELETE', path: '/notes/c', noteId: 'c' });

    const all = await peekAll();
    expect(all).toHaveLength(3);
    expect(all[0]!.path).toBe('/notes');
    expect(all[1]!.path).toBe('/notes/b');
    expect(all[2]!.path).toBe('/notes/c');
  });

  it('peek returns the first op without removing', async () => {
    await enqueue({ method: 'POST', path: '/notes', noteId: 'a' });
    await enqueue({ method: 'PATCH', path: '/notes/b', noteId: 'b' });

    const first = await peek();
    expect(first?.path).toBe('/notes');

    // 仍在队列中
    expect(await size()).toBe(2);
  });

  it('remove deletes a specific op by id', async () => {
    const op1 = await enqueue({ method: 'POST', path: '/notes', noteId: 'a' });
    const op2 = await enqueue({ method: 'PATCH', path: '/notes/b', noteId: 'b' });

    await remove(op1.id);
    const all = await peekAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(op2.id);
  });

  it('size returns 0 on empty queue', async () => {
    expect(await size()).toBe(0);
  });

  it('size reflects enqueued count', async () => {
    await enqueue({ method: 'POST', path: '/notes', noteId: 'a' });
    await enqueue({ method: 'POST', path: '/notes', noteId: 'b' });
    expect(await size()).toBe(2);
  });

  it('clear empties the queue', async () => {
    await enqueue({ method: 'POST', path: '/notes', noteId: 'a' });
    await enqueue({ method: 'POST', path: '/notes', noteId: 'b' });
    await clear();
    expect(await size()).toBe(0);
    expect(await peekAll()).toEqual([]);
  });

  it('bumpRetries increments retry count and removes op after threshold', async () => {
    const op = await enqueue({ method: 'POST', path: '/notes', noteId: 'a' });
    // 默认阈值 MAX_RETRIES=8（指数退避：1+2+4+8+16+30+30+30 ≈ 2 分钟）
    for (let i = 0; i < MAX_RETRIES - 1; i++) {
      await bumpRetries(op.id);
    }
    expect(await size()).toBe(1); // 阈值-1 次仍未移除
    await bumpRetries(op.id); // 第 MAX_RETRIES 次 → 移除
    expect(await size()).toBe(0);
  });

  it('getRetryDelay returns exponential backoff capped at 30s with jitter', () => {
    expect(getRetryDelay(0)).toBeGreaterThanOrEqual(1000);
    expect(getRetryDelay(0)).toBeLessThan(1500);
    expect(getRetryDelay(1)).toBeGreaterThanOrEqual(2000);
    expect(getRetryDelay(1)).toBeLessThan(2500);
    expect(getRetryDelay(10)).toBeGreaterThanOrEqual(30000);
    expect(getRetryDelay(10)).toBeLessThan(30500);
  });

  it('persists across "reload"（内存 mock 验证 persist 调用）', async () => {
    await enqueue({ method: 'PATCH', path: '/notes/x', noteId: 'x' });
    // 验证入队后确实向底层存储写入了队列快照
    const last = saveSnapshots.at(-1);
    expect(Array.isArray(last)).toBe(true);
    expect(last).toHaveLength(1);
    expect(last?.[0]?.path).toBe('/notes/x');
  });

  it('peekAll returns a copy (mutating result does not affect queue)', async () => {
    await enqueue({ method: 'POST', path: '/notes', noteId: 'a' });
    const all = await peekAll();
    all.pop();
    expect(await size()).toBe(1);
  });
});
