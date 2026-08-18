/**
 * 离线队列（简化版）
 *
 * 联机模式下网络不可用时，把 PATCH / POST 请求缓存到 AsyncStorage 队列，
 * 网络恢复后（列表加载成功 / 保存成功时）自动重放。
 *
 * 注意：
 * - 仅联机模式使用（单机模式数据在本地，不存在网络失败）
 * - 队列条目为服务端路径 + 请求体；重放时通过 api 单例发送
 * - 重放失败：
 *   - 网络错误 → 保留条目，等待下次重放
 *   - 其他错误（如 409 版本冲突 / 404）→ 丢弃该条目并告警，避免死循环
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api';

const QUEUE_KEY = 'dustnote_offline_queue';
const MAX_ATTEMPTS = 5;

export interface OfflineQueueItem {
  method: 'PATCH' | 'POST';
  path: string;
  body: unknown;
  queuedAt: string;
  attempts: number;
}

/** 是否网络类错误（fetch 底层 TypeError / ApiException 状态 0） */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const e = err as { name?: string; status?: number; message?: string };
  if (e.name === 'TypeError') return true;
  if (typeof e.status === 'number' && e.status === 0) return true;
  if (typeof e.message === 'string' && /network request failed|network error|fetch failed/i.test(e.message)) {
    return true;
  }
  return false;
}

async function readQueue(): Promise<OfflineQueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OfflineQueueItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: OfflineQueueItem[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

/** 入队一个待同步请求（保存失败时调用） */
export async function enqueueOffline(
  method: 'PATCH' | 'POST',
  path: string,
  body: unknown
): Promise<void> {
  const queue = await readQueue();
  queue.push({
    method,
    path,
    body,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
  await writeQueue(queue);
}

/** 队列中待同步条目数 */
export async function pendingOfflineCount(): Promise<number> {
  return (await readQueue()).length;
}

/**
 * 重放离线队列。网络恢复后调用（如列表加载成功 / 保存成功后）。
 * 返回是否仍有剩余条目（true = 网络仍不可用，下次再试）。
 */
export async function flushOfflineQueue(): Promise<boolean> {
  const queue = await readQueue();
  if (queue.length === 0) return false;

  const remaining: OfflineQueueItem[] = [];
  let networkDown = false;
  for (const item of queue) {
    try {
      await api.request(item.method, item.path, item.body);
      // 成功：不保留
    } catch (err) {
      if (isNetworkError(err)) {
        networkDown = true;
        // 网络不可用：保留并计数，后续重放
        if (item.attempts < MAX_ATTEMPTS) {
          remaining.push({ ...item, attempts: item.attempts + 1 });
        } else {
          console.warn('[offline-queue] 丢弃超过重试上限的请求', item.path);
        }
      } else {
        // 业务错误（版本冲突等）：丢弃，避免死循环
        console.warn('[offline-queue] 重放失败，丢弃条目', item.path, (err as Error).message);
      }
    }
  }
  await writeQueue(remaining);
  return networkDown;
}
