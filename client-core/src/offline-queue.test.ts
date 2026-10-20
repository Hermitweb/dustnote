/**
 * offline-queue 容量上限测试（P0-5）：
 * 真实操作 MemoryQueueStorage，锁死 MAX_QUEUE_OPS / MAX_QUEUE_BYTES 两条边界。
 */
import { describe, it, expect } from 'vitest';
import {
  OfflineQueue,
  MemoryQueueStorage,
  MAX_QUEUE_OPS,
  MAX_QUEUE_BYTES,
  OfflineQueueFullError,
  type QueuedOp,
} from './offline-queue';

function makeQueue() {
  const storage = new MemoryQueueStorage();
  return new OfflineQueue(storage);
}

/** 构造一条最小合法 QueuedOp（method/path/body），id/createdAt/retries 由 enqueue 填。 */
function op(noteTitle: string): Omit<QueuedOp, 'id' | 'createdAt' | 'retries'> {
  return { method: 'PATCH', path: '/notes/abc', body: { title: noteTitle } };
}

describe('OfflineQueue 容量上限', () => {
  it('正常入队：未达上限时接受', async () => {
    const q = makeQueue();
    const full = await q.enqueue(op('a'));
    expect(full.id).toBeTruthy();
    expect(full.retries).toBe(0);
    expect(await q.size()).toBe(1);
  });

  it('MAX_QUEUE_OPS 上限：达到上限后再入队抛 OfflineQueueFullError', async () => {
    const q = makeQueue();
    for (let i = 0; i < MAX_QUEUE_OPS; i++) await q.enqueue(op(`n${i}`));
    expect(await q.size()).toBe(MAX_QUEUE_OPS);
    await expect(q.enqueue(op('overflow'))).rejects.toBeInstanceOf(OfflineQueueFullError);
    // 拒绝后队列不变
    expect(await q.size()).toBe(MAX_QUEUE_OPS);
  });

  it('MAX_QUEUE_BYTES 上限：累计体积超 5MB 时抛错', async () => {
    const q = makeQueue();
    // 单条 600KB；7 条 = 4.2MB（不超 5MB），第 8 条 → 4.8MB 仍不超，
    // 第 9 条 → 5.4MB 必超 MAX_QUEUE_BYTES(5MB)。
    const big = 'x'.repeat(600 * 1024);
    for (let i = 0; i < 8; i++) await q.enqueue(op(big));
    expect(await q.size()).toBe(8);
    await expect(q.enqueue(op(big))).rejects.toBeInstanceOf(OfflineQueueFullError);
    // 拒绝后队列不变
    expect(await q.size()).toBe(8);
    expect(MAX_QUEUE_BYTES).toBe(5 * 1024 * 1024);
  });

  it('remove 后腾出空间，可再入队', async () => {
    const q = makeQueue();
    for (let i = 0; i < MAX_QUEUE_OPS; i++) await q.enqueue(op(`n${i}`));
    const first = await q.peek();
    await q.remove(first!.id);
    expect(await q.size()).toBe(MAX_QUEUE_OPS - 1);
    const added = await q.enqueue(op('new'));
    expect(added.id).toBeTruthy();
    expect(await q.size()).toBe(MAX_QUEUE_OPS);
  });

  it('clear 后恢复容量', async () => {
    const q = makeQueue();
    for (let i = 0; i < MAX_QUEUE_OPS; i++) await q.enqueue(op(`n${i}`));
    await q.clear();
    expect(await q.size()).toBe(0);
    await expect(q.enqueue(op('ok'))).resolves.toBeDefined();
  });
});
