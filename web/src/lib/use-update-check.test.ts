/**
 * web/src/lib/use-update-check.ts 单测 —— 客户端升级检查
 *
 * 覆盖：
 *   - standalone + serverUrl 空 → 直接 ok（不调 checkForUpdate）
 *   - online → 调 checkForUpdate + 透传 ok / force_update / maintenance
 *   - serverUrl 非空 → apiBase 拼绝对地址
 *   - checkForUpdate 抛错 → 收敛为 error（不向外冒泡）
 *   - 5s 节流
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installPolyfills } from '../test/polyfills';
import type { CheckUpdateResult } from '@dustnote/shared';

/**
 * checkUpdateOnce 的返回值类型：生产的 CheckUpdateResult 没有 minVersion 字段，
 * 但 force_update 响应里带最小版本号，测试按此断言——在真实类型上补一个可选字段，
 * 避免用 unknown 逃生舱把状态断言全部掩盖掉。
 */
type UpdateCheckResult = CheckUpdateResult & { minVersion?: string };

installPolyfills();

const checkForUpdate = vi.fn();
vi.mock('@dustnote/shared', () => ({
  checkForUpdate: (...args: unknown[]) => checkForUpdate(...args),
}));

const modeStoreState = vi.hoisted(() => ({
  mode: 'online' as 'online' | 'standalone',
  serverUrl: '',
  baseUrl: '/api/v1',
}));

vi.mock('./mode-store', () => ({
  useModeStore: {
    getState: () => modeStoreState,
  },
}));

vi.mock('./device', () => ({
  getDeviceId: () => 'dev-1',
}));

describe('use-update-check.checkUpdateOnce', () => {
  let checkUpdateOnce: () => Promise<UpdateCheckResult>;

  beforeEach(async () => {
    vi.resetModules();
    checkForUpdate.mockReset();
    modeStoreState.mode = 'online';
    modeStoreState.serverUrl = '';
    modeStoreState.baseUrl = '/api/v1';
    vi.useRealTimers();
    // 每次重置模块 → 重新 import 以清空 module-scope 状态
    const mod = await import('./use-update-check');
    checkUpdateOnce = mod.checkUpdateOnce;
  });

  it('standalone + serverUrl 空 → 直接 ok（不调 checkForUpdate）', async () => {
    modeStoreState.mode = 'standalone';
    modeStoreState.serverUrl = '';
    const r = await checkUpdateOnce();
    expect(r).toEqual({ status: 'ok' });
    expect(checkForUpdate).not.toHaveBeenCalled();
  });

  it('online → 调 checkForUpdate + 透传 ok 状态', async () => {
    checkForUpdate.mockResolvedValue({ status: 'ok' });
    const r = await checkUpdateOnce();
    expect(r.status).toBe('ok');
    expect(checkForUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'web',
        channel: 'stable',
        deviceId: 'dev-1',
        apiBase: '/api/v1',
      })
    );
  });

  it('serverUrl 非空 → apiBase 拼绝对地址', async () => {
    modeStoreState.serverUrl = 'https://api.example.com';
    checkForUpdate.mockResolvedValue({ status: 'ok' });
    await checkUpdateOnce();
    expect(checkForUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ apiBase: 'https://api.example.com/api/v1' })
    );
  });

  it('force_update 透传', async () => {
    checkForUpdate.mockResolvedValue({
      status: 'force_update',
      minVersion: '2.0.0',
      message: 'must upgrade',
    });
    const r = await checkUpdateOnce();
    expect(r.status).toBe('force_update');
    expect(r.minVersion).toBe('2.0.0');
  });

  it('maintenance 透传', async () => {
    checkForUpdate.mockResolvedValue({ status: 'maintenance', message: 'down' });
    const r = await checkUpdateOnce();
    expect(r.status).toBe('maintenance');
  });

  it('checkForUpdate 抛错 → 收敛为 error（不向外冒泡）', async () => {
    checkForUpdate.mockRejectedValueOnce(new Error('network-fail'));
    const r = await checkUpdateOnce();
    expect(r.status).toBe('error');
    expect(r.message).toBe('network-fail');
  });

  it('checkForUpdate 抛非 Error → 收敛为 error + String(err)', async () => {
    checkForUpdate.mockRejectedValueOnce('plain string error');
    const r = await checkUpdateOnce();
    expect(r.status).toBe('error');
    expect(r.message).toBe('plain string error');
  });

  it('节流：5s 内第二次调用 → 复用上次结果（不重新请求）', async () => {
    checkForUpdate.mockResolvedValue({ status: 'ok' });
    const r1 = await checkUpdateOnce();
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    const r2 = await checkUpdateOnce();
    expect(checkForUpdate).toHaveBeenCalledTimes(1); // 复用缓存
    expect(r2).toBe(r1);
  });
});
