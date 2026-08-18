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
 * 3. 10s 超时：服务端不可达时不会无限等待导致 UI 卡顿
 * 4. Tauri 桌面端用 mode-store 的 serverUrl 拼接绝对地址，
 *    避免 relative path /api/v1 请求 Tauri 资源服务器返回 HTML
 * 5. 不监听 visibilitychange：浏览器在 tab 切到后台或页面卸载时
 *    会主动 abort 进行中的 fetch，并在控制台打印 net::ERR_ABORTED，
 *    JS 的 AbortError catch 无法抑制网络层日志。
 */

import { useEffect, useState } from 'react';
import { checkForUpdate, type CheckUpdateResult } from '@dustnote/shared';
import { getDeviceId } from './device';
import { useModeStore } from './mode-store';

const APP_VERSION = __APP_VERSION__; // vite define 注入
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1h
const UPDATE_CHECK_TIMEOUT_MS = 10_000; // 10s 超时，避免卡顿

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

  // 单机模式（无服务器）：跳过 web 更新检查。
  // Tauri 桌面端单机模式下 serverUrl 为空，/api/v1/update-manifest
  // 会请求 Tauri 资源服务器返回 HTML，导致 JSON 解析失败。
  // 桌面端的更新检查由 Velopack（SettingsDialog）负责，不依赖此 API。
  const modeState = useModeStore.getState();
  if (modeState.mode === 'standalone' && !modeState.serverUrl) {
    const result: CheckUpdateResult = { status: 'ok' };
    lastResult = result;
    lastCheckedAt = now;
    return result;
  }

  // 构造绝对 API 基址（Tauri 桌面端必须用绝对地址）
  const { serverUrl } = modeState;
  const apiBase = serverUrl ? `${serverUrl.replace(/\/+$/, '')}/api/v1` : '/api/v1';

  // 10s 超时：AbortController 在超时后 abort fetch，避免 UI 卡顿
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);

  inFlight = checkForUpdate({
    currentVersion: APP_VERSION,
    platform: 'web',
    channel: 'stable',
    deviceId: getDeviceId(),
    apiBase,
    signal: controller.signal,
  }).finally(() => {
    inFlight = null;
    lastCheckedAt = Date.now();
    clearTimeout(timeoutId);
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

  return {
    state,
    result,
    recheck: () => {
      lastCheckedAt = 0;
      void checkUpdateOnce().then((r) => {
        setResult(r);
        setState(r.status === 'ok' ? 'ok' : r.status);
      });
    },
  };
}
