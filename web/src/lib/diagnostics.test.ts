/**
 * diagnostics 测试
 *
 * 用 idb-keyval 的 in-memory 桩绕过 IndexedDB；专注测脱敏 + 环形 buffer + exportDiagnostics。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const memoryStore = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: async (k: string) => memoryStore.get(k),
  set: async (k: string, v: unknown) => {
    memoryStore.set(k, v);
  },
  del: async (k: string) => {
    memoryStore.delete(k);
  },
  clear: async () => {
    memoryStore.clear();
  },
}));

import {
  logger,
  log,
  getAllLogs,
  clearLogs,
  exportDiagnostics,
  getStorageEstimate,
} from './diagnostics';

describe('diagnostics', () => {
  beforeEach(async () => {
    vi.resetModules(); // 每个 case 重置 module-scope buffer
    memoryStore.clear();
    await clearLogs();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('log: 写入后 getAllLogs 可见', async () => {
    await log('info', 'test', 'hello');
    const all = await getAllLogs();
    expect(all.length).toBe(1);
    expect(all[0]!.module).toBe('test');
    expect(all[0]!.msg).toBe('hello');
  });

  it('脱敏：token / password / master 等敏感键 → [REDACTED]', async () => {
    await log('info', 'm', 'm', {
      accessToken: 'secret',
      refreshToken: 'secret',
      password: '123',
      masterKey: 'mk',
      authKey: 'ak',
      recovery: 'rc',
      cookie: 'ck',
      safe: 'visible',
    });
    const all = await getAllLogs();
    const ctx = all[0]!.ctx as Record<string, unknown>;
    expect(ctx.accessToken).toBe('[REDACTED]');
    expect(ctx.password).toBe('[REDACTED]');
    expect(ctx.masterKey).toBe('[REDACTED]');
    expect(ctx.authKey).toBe('[REDACTED]');
    expect(ctx.cookie).toBe('[REDACTED]');
    expect(ctx.safe).toBe('visible');
  });

  it('脱敏：嵌套对象递归', async () => {
    await log('info', 'm', 'm', { user: { password: 'x', name: 'y' } });
    const all = await getAllLogs();
    const user = (all[0]!.ctx as { user: Record<string, unknown> }).user;
    expect(user.password).toBe('[REDACTED]');
    expect(user.name).toBe('y');
  });

  it('超长 string 截断', async () => {
    await log('info', 'm', 'm', { huge: 'x'.repeat(500) });
    const all = await getAllLogs();
    expect((all[0]!.ctx as { huge: string }).huge.length).toBeLessThanOrEqual(220);
  });

  it('环形 buffer: 超过 1000 条丢最旧', async () => {
    for (let i = 0; i < 1050; i++) {
      await log('info', 'm', `m-${i}`);
    }
    const all = await getAllLogs();
    expect(all.length).toBeLessThanOrEqual(1000);
    // 最旧的应该已被丢弃
    expect(all[0]!.msg).not.toBe('m-0');
  });

  it('clearLogs 清空 buffer', async () => {
    await log('info', 'm', 'm');
    await clearLogs();
    const all = await getAllLogs();
    expect(all.length).toBe(0);
  });

  it('logger.error 写 error level', async () => {
    await logger.error('m', 'm');
    const all = await getAllLogs();
    expect(all[0]!.level).toBe('error');
  });

  it('getStorageEstimate 无 navigator.storage → 返回零', async () => {
    const est = await getStorageEstimate();
    expect(est.usage).toBe(0);
    expect(est.quota).toBe(0);
    expect(est.usagePercent).toBe(0);
  });

  it('exportDiagnostics 触发下载', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    await logger.info('m', '准备导出');
    await exportDiagnostics();
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
  });
});
