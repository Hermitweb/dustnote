/**
 * offline-slice / auth-slice 修复回归（2026-10 全面审计）
 *
 * 覆盖两个已修复问题：
 * - C-H：flushQueue 遇 401/403 不再 bumpRetries 烧预算、不再达限静默删 op，
 *   而是中止本轮、队列完整保留、isOnline=false（对齐 M3/429 模式）
 * - C-M：graceUnlock 线上刷新失败按终局/瞬时分流——瞬时保留宽限期缓存可重试，
 *   终局（<500 且非 429）才清缓存落 needs_unlock
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiException } from '@dustnote/shared';
import type { QueuedOp } from '@dustnote/client-core';

// IndexedDB → 内存（jsdom 无 IDB），模式与 offline-queue.test.ts 一致
vi.mock('@dustnote/client-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dustnote/client-core')>();
  return { ...actual, IndexedDbQueueStorage: actual.MemoryQueueStorage };
});

// replayOp 可控替换；其余 helpers（flushingRef/api/cacheNotesLocal…）用真实实现
const { replayOpMock, apiPostMock } = vi.hoisted(() => ({
  replayOpMock: vi.fn(),
  apiPostMock: vi.fn(),
}));
vi.mock('../store-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store-helpers')>();
  return {
    ...actual,
    replayOp: replayOpMock,
    api: () => ({ post: apiPostMock }),
  };
});

const { useStore } = await import('../store');
const { enqueue, peekAll, clear: clearQueue } = await import('../offline-queue');
const { enableGraceUnlock, peekGraceUnlock, clearGraceUnlock } = await import('../grace-unlock');

function apiErr(status: number): ApiException {
  return new ApiException({ status, code: 'e', message: 'test' });
}

describe('flushQueue 鉴权/错误分流（C-H）', () => {
  beforeEach(async () => {
    await clearQueue();
    replayOpMock.mockReset();
    useStore.setState({
      isOnline: true,
      pendingConflicts: [],
      refreshPendingCount: vi.fn().mockResolvedValue(undefined),
      loadAll: vi.fn().mockResolvedValue(undefined),
    } as never);
  });

  it('401：本轮中止,队列完整保留且 retries 不增长', async () => {
    await enqueue({ method: 'POST', path: '/notes', body: {}, noteId: 'a' });
    await enqueue({ method: 'PATCH', path: '/notes/b', body: {}, noteId: 'b' });
    replayOpMock.mockRejectedValue(apiErr(401));

    await useStore.getState().flushQueue();

    // 中止于队首：只尝试了一个 op
    expect(replayOpMock).toHaveBeenCalledTimes(1);
    const ops = await peekAll();
    expect(ops).toHaveLength(2);
    expect(ops[0]?.retries).toBe(0);
    // 离线指示：isOnline=false,且不触发 loadAll（防覆盖未保存输入）
    expect(useStore.getState().isOnline).toBe(false);
    expect(useStore.getState().loadAll).not.toHaveBeenCalled();

    // 反复 flush 不烧重试预算（旧实现 8 轮后静默删 op）
    for (let i = 0; i < 10; i++) await useStore.getState().flushQueue();
    expect((await peekAll()).map((o) => o.retries)).toEqual([0, 0]);
  });

  it('403 同样保留队列', async () => {
    await enqueue({ method: 'POST', path: '/notes', body: {}, noteId: 'a' });
    replayOpMock.mockRejectedValue(apiErr(403));
    await useStore.getState().flushQueue();
    expect(await peekAll()).toHaveLength(1);
    expect(useStore.getState().isOnline).toBe(false);
  });

  it('解锁后重放成功：队列清空、isOnline 恢复', async () => {
    await enqueue({ method: 'POST', path: '/notes', body: {}, noteId: 'a' });
    replayOpMock.mockRejectedValueOnce(apiErr(401));
    await useStore.getState().flushQueue();
    expect(await peekAll()).toHaveLength(1);

    replayOpMock.mockResolvedValue(undefined);
    useStore.setState({ isOnline: true } as never);
    await useStore.getState().flushQueue();
    expect(await peekAll()).toHaveLength(0);
    expect(useStore.getState().isOnline).toBe(true);
  });

  it('其他 4xx（404）：有日志地移除坏 op,不让其卡死队列', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await enqueue({ method: 'PATCH', path: '/notes/ghost', body: {}, noteId: 'ghost' });
    await enqueue({ method: 'POST', path: '/notes', body: {}, noteId: 'ok' });
    replayOpMock.mockRejectedValueOnce(apiErr(404)).mockResolvedValueOnce(undefined);

    await useStore.getState().flushQueue();
    expect(await peekAll()).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('dropping op'),
      '/notes/ghost',
      'PATCH',
      404
    );
    warn.mockRestore();
  });

  it('未知错误不再静默删除：走有界重试', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await enqueue({ method: 'POST', path: '/notes', body: {}, noteId: 'a' });
    replayOpMock.mockRejectedValue(new Error('boom'));
    await useStore.getState().flushQueue();
    const ops: QueuedOp[] = await peekAll();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.retries).toBe(1); // bumpRetries 而非 remove
    warn.mockRestore();
  });
});

describe('graceUnlock 瞬时/终局分流（C-M）', () => {
  const key = new Uint8Array([1, 2, 3]);

  beforeEach(() => {
    clearGraceUnlock();
    apiPostMock.mockReset();
    useStore.setState({
      mode: 'online',
      authState: 'needs_unlock',
      masterKey: null,
      accessToken: null,
    } as never);
  });

  it('瞬时失败（网络 TypeError）：保留宽限期缓存,可重试', async () => {
    enableGraceUnlock(key, null, 5);
    apiPostMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(useStore.getState().graceUnlock()).resolves.toBe(false);
    // 缓存未被消费——再点一次宽限期按钮仍可解锁
    expect(peekGraceUnlock()).toBe(true);
    expect(useStore.getState().authState).toBe('needs_unlock');

    apiPostMock.mockResolvedValue({ accessToken: 'tok' });
    await expect(useStore.getState().graceUnlock()).resolves.toBe(true);
    expect(useStore.getState().authState).toBe('unlocked');
    expect(peekGraceUnlock()).toBe(false);
  });

  it('5xx/429 也算瞬时：保留缓存', async () => {
    enableGraceUnlock(key, null, 5);
    apiPostMock.mockRejectedValue(apiErr(503));
    await expect(useStore.getState().graceUnlock()).resolves.toBe(false);
    expect(peekGraceUnlock()).toBe(true);

    apiPostMock.mockRejectedValue(apiErr(429));
    await expect(useStore.getState().graceUnlock()).resolves.toBe(false);
    expect(peekGraceUnlock()).toBe(true);
  });

  it('终局失败（401/403）：销毁缓存,落 needs_unlock', async () => {
    enableGraceUnlock(key, null, 5);
    apiPostMock.mockRejectedValue(apiErr(401));
    await expect(useStore.getState().graceUnlock()).resolves.toBe(false);
    expect(peekGraceUnlock()).toBe(false);
    expect(useStore.getState().authState).toBe('needs_unlock');
  });

  it('单机模式：直接消费缓存并解锁', async () => {
    useStore.setState({ mode: 'standalone' } as never);
    enableGraceUnlock(key, null, 5);
    await expect(useStore.getState().graceUnlock()).resolves.toBe(true);
    expect(useStore.getState().authState).toBe('unlocked');
    expect(peekGraceUnlock()).toBe(false);
  });
});
