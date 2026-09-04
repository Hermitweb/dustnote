/**
 * Store 共享工具函数（从 store.ts 提取）
 *
 * 被多个 slice 共用的辅助逻辑集中在此。
 * 使用 Zustand 的 `useStore.getState()` 延迟读取，避免循环依赖。
 */

import {
  ApiClient,
  ApiException,
  hkdf,
} from '@dustnote/shared';
import type { NoteRow, NotePlaintext } from './store-types';
import { getDeviceId } from './device';
import { useModeStore } from './mode-store';
import { enqueue, type QueuedOp } from './offline-queue';
import type { ConflictContext } from '@dustnote/client-core';
import type { FetchFn } from '@dustnote/shared';

const API_BASE = '/api/v1';
const APP_VERSION = __APP_VERSION__;

/**
 * 构造 ApiClient（联机模式鉴权 / 数据同步用）
 *
 * 基址选择（与 RemoteRepository 保持一致）：
 * - mode-store 中 serverUrl 不为空 → 拼接 `${serverUrl}/api/v1`（桌面端联机模式）
 * - serverUrl 为空 → 同源 `/api/v1`（Web 部署、开发环境 vite proxy）
 *
 * 注意：accessToken 通过 lazy getter 读取，避免模块加载时的循环依赖。
 * 调用方须在 store 初始化后才调用 api()。
 */
let _getAccessToken: (() => string | null) | null = null;
export function setAccessTokenGetter(getter: () => string | null): void {
  _getAccessToken = getter;
}

// ---------- 401 静默刷新 ----------
// access token 15min 过期;refresh token(30d)走 httpOnly cookie。
// 任一 API 请求 401(且非 /auth/ 自身)→ 单飞刷新 → 换新 token 重放原请求;
// 刷新失败(宽限期已过/被踢)→ 广播 auth-expired,界面回到解锁页。
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const { serverUrl } = useModeStore.getState();
        const base = serverUrl ? `${serverUrl.replace(/\/+$/, '')}/api/v1` : API_BASE;
        const res = await fetch(`${base}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { accessToken: string };
        if (!data.accessToken) return null;
        const { useStore } = await import('./store');
        useStore.setState({ accessToken: data.accessToken });
        return data.accessToken;
      } catch {
        return null;
      } finally {
        // 单飞窗口结束后允许下一次刷新(请求完成后清空)
        setTimeout(() => {
          refreshInFlight = null;
        }, 0);
      }
    })();
  }
  return refreshInFlight;
}

const authFetch: FetchFn = async (url, init) => {
  let res = await fetch(url, init);
  if (res.status === 401 && !String(url).includes('/auth/')) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      const headers = new Headers(init.headers as HeadersInit | undefined);
      headers.set('Authorization', `Bearer ${newToken}`);
      res = await fetch(url, { ...init, headers });
    } else {
      try {
        const { useStore } = await import('./store');
        useStore.setState({ authState: 'needs_unlock' });
      } catch {
        /* ignore */
      }
    }
  }
  return res;
};

export const api = (): ApiClient => {
  const { serverUrl } = useModeStore.getState();
  const baseUrl = serverUrl ? `${serverUrl.replace(/\/+$/, '')}/api/v1` : API_BASE;
  return new ApiClient({
    baseUrl,
    clientVersion: APP_VERSION,
    platform: 'web',
    channel: 'stable',
    deviceId: getDeviceId(),
    accessToken: _getAccessToken?.() ?? undefined,
    fetch: authFetch,
  });
};

/**
 * 判断错误是否为网络故障（应入队重试）。
 *
 * - fetch 抛 TypeError：DNS 解析失败 / 离线 / CORS 阻断 → 入队
 * - ApiException 5xx：服务端错误，可能恢复 → 入队
 * - ApiException 4xx：客户端错误（如 409 冲突），不可恢复 → 不入队
 */
export function isTransientNetworkError(err: unknown): boolean {
  if (err instanceof ApiException) {
    return err.err.status >= 500;
  }
  return err instanceof TypeError;
}

/**
 * 执行一个 mutation；网络失败时入队等待重放。
 *
 * @param op 入队用的操作描述（method/path/body/noteId）
 * @param fn 实际执行网络的函数
 * @param refreshPendingCount 刷新离线队列计数的回调（由调用方注入，避免循环依赖）
 * @returns 成功返回 true，已入队返回 false
 */
export async function runOrEnqueue(
  op: {
    method: 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    noteId?: string;
    conflictCtx?: ConflictContext;
  },
  fn: () => Promise<unknown>,
  refreshPendingCount: () => Promise<void>
): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    if (isTransientNetworkError(err)) {
      await enqueue(op);
      await refreshPendingCount();
      return false;
    }
    throw err;
  }
}

/** flushQueue 重入守卫（模块级，避免并发重放同一批离线操作） */
export const flushingRef = { inFlight: false };

/**
 * 本地明文缓存加密（security.md §3.4）：
 * 缓存明文前先用 masterKey 经 HKDF 派生 localDEK（32B）加密落盘；
 * 未解锁（无 masterKey）时不落明文。lock() 会清掉明文缓存。
 */
const LOCAL_DEK_INFO = 'dustnote-local-dek-v1';
export async function deriveLocalKey(mk: Uint8Array | null): Promise<Uint8Array | null> {
  if (!mk) return null;
  return hkdf(mk, new Uint8Array(0), LOCAL_DEK_INFO, 32);
}

/**
 * 加密缓存笔记到 IndexedDB
 * @param masterKeyGetter 获取当前 masterKey 的回调（避免循环依赖）
 */
export async function cacheNotesLocal(
  notes: Map<string, NoteRow>,
  plain: Map<string, NotePlaintext>,
  masterKeyGetter: () => Uint8Array | null
): Promise<void> {
  const { cacheNotes: cacheNotesRaw } = await import('./db');
  const localKey = (await deriveLocalKey(masterKeyGetter())) ?? undefined;
  return cacheNotesRaw(notes, plain, localKey);
}

/** 重放单个 op：用当前 store 的 accessToken 构造请求 */
export async function replayOp(op: QueuedOp): Promise<void> {
  const client = api();
  await client.request<unknown>(op.method, op.path, op.body);
}
