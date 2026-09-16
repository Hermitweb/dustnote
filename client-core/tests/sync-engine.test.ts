import { describe, it, expect, vi } from 'vitest';
import {
  SyncEngine,
  RATE_LIMIT_MAX_RETRIES,
  type SyncEngineHooks,
} from '../src/sync-engine.js';
import {
  OfflineQueue,
  MemoryQueueStorage,
  MAX_RETRIES,
  type QueuedOp,
} from '../src/offline-queue.js';

/** 构造一个 ApiException 鸭子类型（与 web ApiException 结构一致） */
function apiErr(status: number, data?: unknown): unknown {
  return { err: { status, data, code: 'x', message: 'm' } };
}

async function setup(
  ops: Array<Omit<QueuedOp, 'id' | 'createdAt' | 'retries'>>
): Promise<{ queue: OfflineQueue; replay: ReturnType<typeof vi.fn> }> {
  const storage = new MemoryQueueStorage();
  const queue = new OfflineQueue(storage);
  for (const op of ops) await queue.enqueue(op);
  const replay = vi.fn();
  return { queue, replay };
}

describe('SyncEngine.flush', () => {
  it('replays all ops successfully, removes them, remaining=0', async () => {
    const { queue, replay } = await setup([
      { method: 'PATCH', path: '/notes/1', body: {} },
      { method: 'PATCH', path: '/notes/2', body: {} },
    ]);
    replay.mockResolvedValue(undefined);
    const onFlushed = vi.fn();
    const engine = new SyncEngine(queue, { replayOp: replay, onFlushed });

    const summary = await engine.flush();

    expect(replay).toHaveBeenCalledTimes(2);
    expect(summary.remaining).toBe(0);
    expect(summary.hadConflict).toBe(false);
    expect(onFlushed).toHaveBeenCalledWith({ hadConflict: false, remaining: 0 });
  });

  it('empty queue → no replay, remaining=0', async () => {
    const { queue, replay } = await setup([]);
    const engine = new SyncEngine(queue, { replayOp: replay });
    const summary = await engine.flush();
    expect(replay).not.toHaveBeenCalled();
    expect(summary.remaining).toBe(0);
  });

  it('409 → calls onConflict with server data, removes op', async () => {
    const { queue, replay } = await setup([
      { method: 'PATCH', path: '/notes/1', body: {}, noteId: 'n1' },
    ]);
    const serverCurrent = { id: 'n1', version: 5, ciphertext: 'enc' };
    replay.mockRejectedValueOnce(apiErr(409, { current: serverCurrent }));
    const onConflict = vi.fn().mockResolvedValue(true);
    const engine = new SyncEngine(queue, { replayOp: replay, onConflict });

    const summary = await engine.flush();

    expect(onConflict).toHaveBeenCalledTimes(1);
    const [opArg, dataArg] = onConflict.mock.calls[0]!;
    expect(opArg.path).toBe('/notes/1');
    expect(dataArg).toEqual({ current: serverCurrent });
    expect(summary.hadConflict).toBe(true);
    expect(await queue.size()).toBe(0); // op removed
  });

  it('409 without onConflict hook → still removes op (no crash)', async () => {
    const { queue, replay } = await setup([{ method: 'PATCH', path: '/notes/1', body: {} }]);
    replay.mockRejectedValueOnce(apiErr(409, { current: {} }));
    const engine = new SyncEngine(queue, { replayOp: replay });

    const summary = await engine.flush();

    expect(summary.hadConflict).toBe(true);
    expect(await queue.size()).toBe(0);
  });

  it('other 4xx (e.g. 404) → removes op, hadConflict=true', async () => {
    const { queue, replay } = await setup([{ method: 'DELETE', path: '/notes/1/permanent' }]);
    replay.mockRejectedValueOnce(apiErr(404));
    const engine = new SyncEngine(queue, { replayOp: replay });

    const summary = await engine.flush();

    expect(summary.hadConflict).toBe(true);
    expect(await queue.size()).toBe(0);
  });

  it('5xx → bumpRetries + keeps op, continues to next', async () => {
    const { queue, replay } = await setup([
      { method: 'PATCH', path: '/notes/1', body: {} },
      { method: 'PATCH', path: '/notes/2', body: {} },
    ]);
    // 第一条 500（保留+退避），第二条成功
    replay.mockRejectedValueOnce(apiErr(500)).mockResolvedValueOnce(undefined);
    const engine = new SyncEngine(queue, { replayOp: replay });

    const summary = await engine.flush();

    expect(replay).toHaveBeenCalledTimes(2);
    expect(await queue.size()).toBe(1); // 第一条保留
    expect(summary.remaining).toBe(1);
  });

  it('429 → 保留并退避（不落入其余 4xx 丢弃分支，审计 C1 回归锁定）', async () => {
    const { queue, replay } = await setup([
      { method: 'POST', path: '/notes', body: {} },
      { method: 'PATCH', path: '/notes/2', body: {} },
    ]);
    // 第一条 429（写限流），第二条成功——429 必须保留而非删除
    replay.mockRejectedValueOnce(apiErr(429)).mockResolvedValueOnce(undefined);
    const engine = new SyncEngine(queue, { replayOp: replay });

    const summary = await engine.flush();

    expect(replay).toHaveBeenCalledTimes(2);
    const remaining = await queue.peekAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.path).toBe('/notes'); // 429 那条仍在队列
    expect(summary.remaining).toBe(1);
  });

  it('429 使用独立重试阈值（高于 5xx 的 8 次，9 次 bump 后仍在队列）', async () => {
    // 直接验证阈值语义而非跑 9 轮真实 flush（429 分支内联退避 sleep 会拖满超时）
    expect(RATE_LIMIT_MAX_RETRIES).toBeGreaterThan(MAX_RETRIES);
    const { queue } = await setup([{ method: 'POST', path: '/notes', body: {} }]);
    const op = (await queue.peekAll())[0]!;
    for (let i = 0; i < 9; i++) {
      await queue.bumpRetries(op.id, RATE_LIMIT_MAX_RETRIES);
    }
    // 9 次（> 5xx 的 8 次阈值）后 op 仍在——限流不该因重试次数耗尽而丢数据
    expect(await queue.peekAll()).toHaveLength(1);
  });

  it('TypeError (network down) → stops, keeps remaining', async () => {
    const { queue, replay } = await setup([
      { method: 'PATCH', path: '/notes/1', body: {} },
      { method: 'PATCH', path: '/notes/2', body: {} },
      { method: 'PATCH', path: '/notes/3', body: {} },
    ]);
    // 第一条 TypeError → 停止，后两条不再 replay
    replay.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const engine = new SyncEngine(queue, { replayOp: replay });

    const summary = await engine.flush();

    expect(replay).toHaveBeenCalledTimes(1);
    expect(await queue.size()).toBe(3); // 全部保留
    expect(summary.remaining).toBe(3);
  });

  it('unknown error → drops op to avoid blocking', async () => {
    const { queue, replay } = await setup([{ method: 'PATCH', path: '/notes/1', body: {} }]);
    replay.mockRejectedValueOnce(new Error('weird'));
    const engine = new SyncEngine(queue, { replayOp: replay });

    await engine.flush();
    expect(await queue.size()).toBe(0);
  });

  it('reentrancy guard: concurrent flush runs once', async () => {
    const { queue, replay } = await setup([{ method: 'PATCH', path: '/notes/1', body: {} }]);
    // 让 replay 慢一点，以便并发触发第二次 flush
    replay.mockImplementation(() => new Promise((r) => setTimeout(() => r(undefined), 20)));
    const engine = new SyncEngine(queue, { replayOp: replay });

    const [a, b] = await Promise.all([engine.flush(), engine.flush()]);

    // 第二次因重入守卫直接返回，不重复 replay
    expect(replay).toHaveBeenCalledTimes(1);
    // 第一次 flush 处理完整个队列
    expect(a.remaining).toBe(0);
    // 第二次早返回，未处理；remaining 可能是 0 或 1（取决于与第一次的竞态），
    // 关键保证是 replay 只被调用一次（重入守卫生效）
    expect(b.remaining).toBeGreaterThanOrEqual(0);
  });

  it('onConflict failure does not crash flush (op still removed)', async () => {
    const { queue, replay } = await setup([{ method: 'PATCH', path: '/notes/1', body: {} }]);
    replay.mockRejectedValueOnce(apiErr(409, { current: {} }));
    const onConflict = vi.fn().mockRejectedValue(new Error('merge boom'));
    const engine = new SyncEngine(queue, { replayOp: replay, onConflict });

    const summary = await engine.flush();
    expect(summary.hadConflict).toBe(true);
    expect(await queue.size()).toBe(0);
  });

  it('custom classifyError is respected', async () => {
    const { queue, replay } = await setup([{ method: 'PATCH', path: '/notes/1', body: {} }]);
    // 抛一个非标准错误，用自定义分类器把它归为 409
    replay.mockRejectedValueOnce({ kind: 'version_conflict', serverNote: { v: 9 } });
    const onConflict = vi.fn().mockResolvedValue(true);
    const classifyError = (err: unknown) => {
      const e = err as { kind?: string; serverNote?: unknown };
      if (e && e.kind === 'version_conflict') {
        return { status: 409, data: e.serverNote };
      }
      return null;
    };
    const engine = new SyncEngine(queue, {
      replayOp: replay,
      onConflict,
      classifyError,
    } as SyncEngineHooks);

    const summary = await engine.flush();
    expect(onConflict).toHaveBeenCalledWith(expect.anything(), { v: 9 });
    expect(summary.hadConflict).toBe(true);
  });
});
