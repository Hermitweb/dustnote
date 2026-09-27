/**
 * 桌面端 Tauri 桥接（TEST-004）
 *
 * 盯的是"环境判断"与"IPC 挂起"两类：这两类错了不会报错，只会静默走错分支
 * （浏览器里当桌面用 / 界面永久转圈）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetInvoke, setInvokeHandler } from '../../test/mocks/tauri-core';
import {
  isTauri,
  getApiBase,
  getPlatformHeaders,
  getDeviceId,
  createApiClient,
  invokeWithTimeout,
} from './tauri';

const TAURI_FLAG = '__TAURI_INTERNALS__';

function asDesktop(on: boolean): void {
  if (on) (window as unknown as Record<string, unknown>)[TAURI_FLAG] = {};
  else delete (window as unknown as Record<string, unknown>)[TAURI_FLAG];
}

describe('环境判断', () => {
  afterEach(() => asDesktop(false));

  it('没有 __TAURI_INTERNALS__ 就不是桌面端，API 基址走相对路径', () => {
    asDesktop(false);
    expect(isTauri()).toBe(false);
    expect(getApiBase()).toBe('/api/v1');
  });

  it('有 __TAURI_INTERNALS__ 才连本机 server 绝对地址', () => {
    asDesktop(true);
    expect(isTauri()).toBe(true);
    expect(getApiBase()).toBe('http://localhost:3210/api/v1');
  });

  it('平台头三件套：platform / channel / version 都在，且版本来自构建注入', () => {
    const h = getPlatformHeaders();
    expect(h['X-Client-Platform']).toBe('desktop');
    expect(h['X-Client-Channel']).toBe('stable');
    expect(h['X-Client-Version']).toBeTruthy();
    expect(h['X-Client-Version']).not.toContain('undefined');
  });
});

describe('设备 id', () => {
  it('两次取用同一个值，并落进 localStorage（灰度切分与按设备撤销都靠它）', () => {
    const a = getDeviceId();
    expect(a).toMatch(/^[0-9a-f-]{20,}$/);
    expect(getDeviceId()).toBe(a);
    expect(Object.keys(localStorage).some((k) => localStorage.getItem(k) === a)).toBe(true);
  });

  it('createApiClient 把设备 id 与平台一起带上', () => {
    const c = createApiClient('tok');
    expect(c).toBeTruthy();
  });
});

describe('invokeWithTimeout', () => {
  beforeEach(() => resetInvoke());
  afterEach(() => vi.useRealTimers());

  it('正常返回时透传结果', async () => {
    setInvokeHandler(() => 'pong');
    await expect(invokeWithTimeout<string>('ping')).resolves.toBe('pong');
  });

  it('Rust 侧不回应时按超时失败，而不是让调用方永久挂起', async () => {
    vi.useFakeTimers();
    setInvokeHandler(() => new Promise(() => undefined)); // 永不 resolve
    const p = invokeWithTimeout('hang_cmd', undefined, 1000);
    const settled = vi.fn();
    void p.catch(() => settled());
    await vi.advanceTimersByTimeAsync(1001);
    await expect(p).rejects.toThrow(/IPC timeout: hang_cmd/);
    expect(settled).toHaveBeenCalled();
  });

  it('超时消息带上命令名（否则线上只看到一句 timeout，定位不到是哪个 IPC）', async () => {
    vi.useFakeTimers();
    setInvokeHandler(() => new Promise(() => undefined));
    const p = invokeWithTimeout('download_and_run_installer', undefined, 500);
    vi.advanceTimersByTime(501);
    await expect(p).rejects.toThrow('download_and_run_installer');
  });
});
