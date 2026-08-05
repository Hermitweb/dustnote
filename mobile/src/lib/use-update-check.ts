/**
 * 移动端更新检查（v2.0.0）
 *
 * 复用 shared/src/update-check.ts 的 checkForUpdate，platform 设为 'android'。
 * 仅联机模式可用——单机模式无服务器，跳过检查。
 *
 * 设计要点：
 * 1. 10s 超时（AbortController），避免网络不通时 UI 长时间等待
 * 2. 5s 节流，避免短时间内重复请求
 * 3. 单机模式直接返回 ok（无服务端可查）
 */

import { checkForUpdate, type CheckUpdateResult } from '@dustnote/shared';
import { getCurrentMode, resolveBaseUrl } from './mode-store';
import { useAuthStore } from '../state/auth';

// 与 package.json 同步（全端版本统一，见 release 流程）
const APP_VERSION = '2.4.4';
const UPDATE_CHECK_TIMEOUT_MS = 10_000; // 10s 超时
const MIN_INTERVAL_MS = 5_000; // 节流：5s 内不发重复请求

// module-scope 状态：跨组件实例复用
let lastResult: CheckUpdateResult | null = null;
let lastCheckedAt = 0;

export async function checkUpdateOnce(): Promise<CheckUpdateResult> {
  const now = Date.now();
  if (lastResult && now - lastCheckedAt < MIN_INTERVAL_MS) {
    return lastResult;
  }

  // 单机模式（无服务器）：跳过更新检查
  const { mode } = getCurrentMode();
  if (mode === 'standalone') {
    const result: CheckUpdateResult = { status: 'ok', message: '单机模式无需检查更新' };
    lastResult = result;
    lastCheckedAt = now;
    return result;
  }

  const apiBase = resolveBaseUrl();
  const deviceId = useAuthStore.getState().deviceId ?? 'android-unknown';

  // 10s 超时：AbortController 在超时后 abort fetch
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);

  try {
    const r = await checkForUpdate({
      currentVersion: APP_VERSION,
      platform: 'android',
      channel: 'stable',
      deviceId,
      apiBase,
      signal: controller.signal,
    });
    lastResult = r;
    lastCheckedAt = Date.now();
    return r;
  } catch (err) {
    // AbortError 由 checkForUpdate 内部处理，这里兜底
    const result: CheckUpdateResult = {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    lastResult = result;
    lastCheckedAt = Date.now();
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** 重置缓存（用户手动重试时调用） */
export function resetUpdateCache(): void {
  lastResult = null;
  lastCheckedAt = 0;
}
