import { describe, it, expect } from 'vitest';
import {
  OfflineQueue,
  MemoryQueueStorage,
  getRetryDelay,
  MAX_RETRIES,
  type QueuedOp,
} from '../src/offline-queue.js';

function mkOp(path: string, method: QueuedOp['method'] = 'PATCH'): Omit<QueuedOp, 'id' | 'createdAt' | 'retries'> {
  return { method, path, body: { x: 1 }, noteId: 'n1' };
}

describe('OfflineQueue (MemoryQueueStorage)', () => {
  it('enqueue / peek / peekAll / size', async () => {
    const q = new OfflineQueue(new MemoryQueueStorage());
    expect(await q.size()).toBe(0);
    const a = await q.enqueue(mkOp('/notes/1'));
    const b = await q.enqueue(mkOp('/notes/2'));
    expect(await q.size()).toBe(2);
    expect((await q.peek())?.id).toBe(a.id);
    expect(await q.peekAll()).toHaveLength(2);
    expect(a.id).not.toBe(b.id);
    expect(a.retries).toBe(0);
    expect(a.createdAt).toBeTruthy();
  });

  it('remove', async () => {
    const q = new OfflineQueue(new MemoryQueueStorage());
    const a = await q.enqueue(mkOp('/notes/1'));
    await q.enqueue(mkOp('/notes/2'));
    await q.remove(a.id);
    expect(await q.size()).toBe(1);
    expect((await q.peek())?.path).toBe('/notes/2');
  });

  it('bumpRetries increments and removes at threshold', async () => {
    const q = new OfflineQueue(new MemoryQueueStorage(), );
    const a = await q.enqueue(mkOp('/notes/1'));
    for (let i = 0; i < MAX_RETRIES - 1; i++) {
      await q.bumpRetries(a.id);
    }
    const all = await q.peekAll();
    expect(all[0]!.retries).toBe(MAX_RETRIES - 1);
    // 达到阈值 → 移除
    await q.bumpRetries(a.id);
    expect(await q.size()).toBe(0);
  });

  it('getRetryDelayForOp reflects retries', async () => {
    const q = new OfflineQueue(new MemoryQueueStorage());
    const a = await q.enqueue(mkOp('/notes/1'));
    const d0 = await q.getRetryDelayForOp(a.id);
    expect(d0).toBeGreaterThanOrEqual(1000);
    expect(d0).toBeLessThanOrEqual(30_500);
    await q.bumpRetries(a.id);
    const d1 = await q.getRetryDelayForOp(a.id);
    // attempt 1 → base 2000
    expect(d1).toBeGreaterThanOrEqual(2000);
  });

  it('clear empties the queue', async () => {
    const q = new OfflineQueue(new MemoryQueueStorage());
    await q.enqueue(mkOp('/notes/1'));
    await q.enqueue(mkOp('/notes/2'));
    await q.clear();
    expect(await q.size()).toBe(0);
    expect(await q.peekAll()).toHaveLength(0);
  });

  it('carries optional conflictCtx', async () => {
    const q = new OfflineQueue(new MemoryQueueStorage());
    const ctx = {
      noteId: 'n1',
      baseVersion: 3,
      base: {
        id: 'n1',
        plaintext: { title: 't', content: 'c', tags: [] },
        isPinned: false,
        isFavorite: false,
        deletedAt: null,
        folderId: null,
        clientUpdatedAt: 'ts',
      },
      local: {
        id: 'n1',
        plaintext: { title: 't2', content: 'c', tags: [] },
        isPinned: false,
        isFavorite: false,
        deletedAt: null,
        folderId: null,
        clientUpdatedAt: 'ts2',
      },
    };
    const a = await q.enqueue({ method: 'PATCH', path: '/notes/n1', body: {}, noteId: 'n1', conflictCtx: ctx });
    const all = await q.peekAll();
    expect(all[0]!.conflictCtx).toEqual(ctx);
    expect(all[0]!.conflictCtx?.baseVersion).toBe(3);
  });

  it('getRetryDelay bounds', () => {
    for (let i = 0; i < 12; i++) {
      const d = getRetryDelay(i);
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(30_500);
    }
  });
});
