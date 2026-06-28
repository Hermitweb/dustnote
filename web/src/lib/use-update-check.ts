/**
 * 客户端 update-check 包装
 * - 启动时检查一次
 * - 强制升级阻塞 UI
 * - 软提示展示非阻塞 banner
 * - 每小时轮询一次
 *
 * 设计要点：
 * 1. module-scope 缓存 in-flight Promise，避开 React StrictMode 双调用
 *    / Fast Refresh 重执行 effect 时重复发请求
 * 2. 5s 节流，避免短时间内重复请求
 * 3. 不监听 visibilitychange：浏览器在 tab 切到后台或页面卸载时
 *    会主动 abort 进行中的 fetch，并在控制台打印 net::ERR_ABORTED，
 *    JS 的 AbortError catch 无法抑制网络层日志。
 *    如果用户在后台回到前台时正好在 1h 轮询窗口内，interval
 *    会自然触发；不在窗口内则用户操作（新建/解锁）会触发下一次轮询。
 */

import { useEffect, useState } from 'react';
import { checkForUpdate, type CheckUpdateResult } from '@dustnote/shared';
import { getDeviceId } from './device';

const APP_VERSION = __APP_VERSION__; // vite define 注入
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1h

// module-scope 状态：跨 effect / 跨组件实例复用同一份 in-flight 状态
let inFlight: Promise<CheckUpdateResult> | null = null;
let lastResult: CheckUpdateResult | null = null;
let lastCheckedAt = 0;
const MIN_INTERVAL_MS = 5_000; // 节流：5s 内不发重复请求

export async function checkUpdateOnce(): Promise<CheckUpdateResult> {
  const now = Date.now();
  if (inFlight) return inFlight;
  if (lastResult && now - lastCheckedAt < MIN_INTERVAL_MS) {
    return lastResult;
  }
  inFlight = checkForUpdate({
    currentVersion: APP_VERSION,
    platform: 'web',
    channel: 'stable',
    deviceId: getDeviceId(),
  }).finally(() => {
    inFlight = null;
    lastCheckedAt = Date.now();
  });
  try {
    const r = await inFlight;
    lastResult = r;
    return r;
  } catch (err) {
    // 任何意外错误统一收敛为 error 状态，不向 console 冒泡
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface UseUpdateCheckReturn {
  state: 'idle' | 'checking' | 'ok' | 'force_update' | 'maintenance' | 'error';
  result: CheckUpdateResult | null;
  recheck: () => void;
}

export function useUpdateCheck(): UseUpdateCheckReturn {
  const [state, setState] = useState<UseUpdateCheckReturn['state']>('idle');
  const [result, setResult] = useState<CheckUpdateResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setState('checking');
      const r = await checkUpdateOnce();
      if (cancelled) return;
      setResult(r);
      setState(r.status === 'ok' ? 'ok' : r.status);
    };

    void run();
    const id = setInterval(() => void run(), CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
      // 注意：不 abort in-flight，让它自然完成
    };
  }, []);

  return { state, result, recheck: () => undefined };
}
