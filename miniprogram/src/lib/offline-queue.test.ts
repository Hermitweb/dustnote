/**
 * 离线队列适配层（TEST-004）
 *
 * 队列语义本体在 client-core（那边已有测试），这里钉的是**小程序适配层自己**的三件事：
 * 1. 什么算"网络错误"——判错会把 4xx 业务错误也塞进队列，重放时反复失败；
 *    判漏则网络抖动直接丢编辑。
 * 2. 队列真的落到 Taro storage（冷启动后还在，否则"离线"等于"丢弃"）。
 * 3. 存储被写坏时能安全回落，而不是让页面崩在解析上。
 *
 * 注意：`queue` 是模块级单例（内存 + 存储双写），所以每个用例都要 resetModules
 * 重新导入，否则上一条用例攒的条目会漏进下一条——这本身就是队列的真实行为。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isNetworkError } from './offline-queue';
import { resetStorage, dumpStorage } from '../../test/mocks/taro';

const QUEUE_KEY = 'dustnote:offline-queue';

describe('isNetworkError', () => {
  it('fetch 底层的 TypeError 算网络错误', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('status 0 算网络错误（weapp request 失败时的形态）', () => {
    expect(isNetworkError({ status: 0, message: 'fail' })).toBe(true);
  });

  it('常见网络文案算网络错误', () => {
    for (const m of ['Network request failed', 'network error', 'fetch failed']) {
      expect(isNetworkError({ message: m })).toBe(true);
    }
  });

  it('业务错误不算网络错误：4xx/5xx 必须原样抛出，不能进队列反复重放', () => {
    for (const status of [400, 401, 403, 409, 500]) {
      expect(isNetworkError({ status, message: 'ApiError' })).toBe(false);
    }
  });

  it('空对象与字符串不炸', () => {
    expect(isNetworkError({})).toBe(false);
    expect(isNetworkError('boom')).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});

describe('队列持久化', () => {
  let enqueueOffline: typeof import('./offline-queue').enqueueOffline;
  let pendingOfflineCount: typeof import('./offline-queue').pendingOfflineCount;

  beforeEach(async () => {
    resetStorage();
    vi.resetModules();
    const mod = await import('./offline-queue');
    enqueueOffline = mod.enqueueOffline;
    pendingOfflineCount = mod.pendingOfflineCount;
  });

  it('入队即落 Taro storage，冷启动后仍能读回', async () => {
    await enqueueOffline('PATCH', '/notes/n1', { ciphertext: 'ct' }, { noteId: 'n1' });
    expect(await pendingOfflineCount()).toBe(1);
    const raw = dumpStorage()[QUEUE_KEY];
    expect(typeof raw).toBe('string');
    const parsed = JSON.parse(String(raw)) as Array<{ path: string; noteId?: string }>;
    expect(parsed[0]?.path).toBe('/notes/n1');
    expect(parsed[0]?.noteId).toBe('n1');
  });

  it('多条按序累积，count 与存储内容一致', async () => {
    await enqueueOffline('PATCH', '/notes/a', {});
    await enqueueOffline('POST', '/notes', {});
    expect(await pendingOfflineCount()).toBe(2);
    expect((JSON.parse(String(dumpStorage()[QUEUE_KEY])) as unknown[]).length).toBe(2);
  });

  it('存储被写坏时读回空队列，而不是让页面崩在 JSON.parse 上', async () => {
    resetStorage({ [QUEUE_KEY]: '{ not json' });
    vi.resetModules();
    const mod = await import('./offline-queue');
    expect(await mod.pendingOfflineCount()).toBe(0);
  });

  it('队列是跨页面共享的单例：重新导入模块后仍读得到上一条写入的条目', async () => {
    await enqueueOffline('PATCH', '/notes/x', {});
    vi.resetModules();
    const again = await import('./offline-queue');
    expect(await again.pendingOfflineCount()).toBe(1);
  });
});
