/**
 * server/src/services/backup-scheduler.ts 单测 —— 备份调度 + 失败告警 + SQLite 维护
 *
 * 策略：mock setInterval/setTimeout 替换为同步队列；mock runBackup 返回受控 promise。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

let testDb: DatabaseType;
const runBackup = vi.fn();
const captureSpy = vi.fn();
const logInfo = vi.fn();
const logWarn = vi.fn();
const logError = vi.fn();
const incSpy = vi.fn();
const pragmaSpy = vi.fn();
const execSpy = vi.fn();

// 用受控的 fake timers 让 setInterval/setTimeout 同步可读
let intervalCallbacks: Array<() => void> = [];
let timeoutCallbacks: Array<() => void> = [];
let unrefedHandles = 0;
const fakeSetInterval = vi.fn((cb: () => void) => {
  intervalCallbacks.push(cb);
  return { unref: () => unrefedHandles++ } as unknown as ReturnType<typeof setInterval>;
});
const fakeSetTimeout = vi.fn((cb: () => void) => {
  timeoutCallbacks.push(cb);
  return { unref: () => unrefedHandles++ } as unknown as ReturnType<typeof setTimeout>;
});
const fakeClearInterval = vi.fn();
const fakeClearTimeout = vi.fn();

vi.mock('../db.js', () => ({ getDb: () => testDb }));
vi.mock('../scripts/backup.js', () => ({ runBackup }));
vi.mock('../logger.js', () => ({
  logger: {
    info: (...args: unknown[]) => logInfo(...args),
    warn: (...args: unknown[]) => logWarn(...args),
    error: (...args: unknown[]) => logError(...args),
    debug: () => undefined,
  },
}));
vi.mock('../sentry.js', () => ({ captureException: captureSpy }));
vi.mock('../metrics.js', () => ({
  backupRunsTotal: { inc: (labels: { result: string }) => incSpy(labels) },
}));

beforeAll(() => {
  testDb = new Database(':memory:');
  // 拦截 pragma/exec 用于 sqliteMaintenance 验证
  const origPragma = testDb.pragma.bind(testDb);
  const origExec = testDb.exec.bind(testDb);
  testDb.pragma = ((...args: unknown[]) => {
    pragmaSpy(...args);
    return origPragma(...(args as Parameters<typeof origPragma>));
  }) as typeof testDb.pragma;
  testDb.exec = ((sql: string) => {
    execSpy(sql);
    return origExec(sql);
  }) as typeof testDb.exec;
  // 替换全局定时器
  globalThis.setInterval = fakeSetInterval as unknown as typeof setInterval;
  globalThis.clearInterval = fakeClearInterval as unknown as typeof clearInterval;
  globalThis.setTimeout = fakeSetTimeout as unknown as typeof setTimeout;
  globalThis.clearTimeout = fakeClearTimeout as unknown as typeof clearTimeout;
});

afterAll(() => {
  testDb.close();
});

beforeEach(async () => {
  intervalCallbacks = [];
  timeoutCallbacks = [];
  unrefedHandles = 0;
  runBackup.mockReset();
  captureSpy.mockReset();
  logInfo.mockReset();
  logWarn.mockReset();
  logError.mockReset();
  incSpy.mockReset();
  pragmaSpy.mockReset();
  execSpy.mockReset();
  fakeSetInterval.mockClear();
  fakeSetTimeout.mockClear();
  fakeClearInterval.mockClear();
  fakeClearTimeout.mockClear();
  // 重置 module state（通过 import 拿到 fresh exports）
  vi.resetModules();
  // 重新注册 mocks（resetModules 不会清 vi.mock）
});

// 用 dynamic import 让每次测试拿到全新 module state
async function load() {
  return import('./backup-scheduler.js');
}

describe('backup-scheduler 调度生命周期', () => {
  it('startBackupSchedule 启动 60s 后立即跑 + 24h 周期 + unref', async () => {
    const { startBackupSchedule, stopBackupSchedule } = await load();
    startBackupSchedule();
    // 注册了 firstTimer (60s) + interval (24h)
    expect(fakeSetTimeout).toHaveBeenCalledTimes(1);
    expect(fakeSetInterval).toHaveBeenCalledTimes(1);
    // 两个定时器都 unref（防止阻塞进程退出）
    expect(unrefedHandles).toBe(2);
    // 日志：调度已启动
    expect(logInfo).toHaveBeenCalledWith({ intervalHours: 24 }, '自动备份调度已启动');
    stopBackupSchedule();
  });

  it('二次 startBackupSchedule → 早返回（不重复注册）', async () => {
    const { startBackupSchedule, stopBackupSchedule } = await load();
    startBackupSchedule();
    const callsAfterFirst = fakeSetTimeout.mock.calls.length + fakeSetInterval.mock.calls.length;
    startBackupSchedule();
    const callsAfterSecond = fakeSetTimeout.mock.calls.length + fakeSetInterval.mock.calls.length;
    expect(callsAfterSecond).toBe(callsAfterFirst);
    stopBackupSchedule();
  });

  it('stopBackupSchedule → clearInterval + clearTimeout + null 化', async () => {
    const { startBackupSchedule, stopBackupSchedule } = await load();
    startBackupSchedule();
    stopBackupSchedule();
    expect(fakeClearInterval).toHaveBeenCalled();
    expect(fakeClearTimeout).toHaveBeenCalled();
  });

  it('未启动就 stop → 不报错（idempotent）', async () => {
    const { stopBackupSchedule } = await load();
    expect(() => stopBackupSchedule()).not.toThrow();
    expect(fakeClearInterval).not.toHaveBeenCalled();
    expect(fakeClearTimeout).not.toHaveBeenCalled();
  });
});

describe('backup-scheduler 第一次跑（启动 60s 后）', () => {
  it('runBackup 成功 → backupRunsTotal.inc(ok) + 不报错', async () => {
    runBackup.mockResolvedValueOnce(undefined);
    const { startBackupSchedule, stopBackupSchedule } = await load();
    startBackupSchedule();
    // 触发 firstTimer
    expect(timeoutCallbacks).toHaveLength(1);
    const cb = timeoutCallbacks[0]!;
    void cb();
    // runBackup 返回的 promise 已 resolve → .then() 执行 → inc({result:'ok'})
    await new Promise((r) => setImmediate(r));
    expect(runBackup).toHaveBeenCalledTimes(1);
    expect(incSpy).toHaveBeenCalledWith({ result: 'ok' });
    expect(logError).not.toHaveBeenCalled();
    stopBackupSchedule();
  });

  it('runBackup 失败 → backupRunsTotal.inc(fail) + onBackupFailure（log + sentry）', async () => {
    const failErr = new Error('disk full');
    runBackup.mockRejectedValueOnce(failErr);
    const { startBackupSchedule, stopBackupSchedule } = await load();
    startBackupSchedule();
    const cb = timeoutCallbacks[0]!;
    void cb();
    await new Promise((r) => setImmediate(r));
    expect(incSpy).toHaveBeenCalledWith({ result: 'fail' });
    // onBackupFailure('启动', err) 路径
    expect(logError).toHaveBeenCalledWith(
      { err: failErr, where: '启动' },
      expect.stringContaining('备份失败')
    );
    expect(captureSpy).toHaveBeenCalledWith(failErr);
    stopBackupSchedule();
  });
});

describe('backup-scheduler 每日周期（24h 一次）', () => {
  it('runBackup 成功 → .finally(sqliteMaintenance) → wal_checkpoint + 不调 VACUUM（第 1 次）', async () => {
    runBackup.mockResolvedValue(undefined);
    const { startBackupSchedule, stopBackupSchedule } = await load();
    startBackupSchedule();
    // 触发 interval
    expect(intervalCallbacks).toHaveLength(1);
    void intervalCallbacks[0]!();
    await new Promise((r) => setImmediate(r));
    // wal_checkpoint(TRUNCATE) 跑了
    expect(pragmaSpy).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)');
    // dailyRunCount=1, % 7 !== 0 → 不调 VACUUM
    expect(execSpy).not.toHaveBeenCalledWith('VACUUM');
    stopBackupSchedule();
  });

  it('第 7 次跑 → VACUUM 触发', async () => {
    runBackup.mockResolvedValue(undefined);
    const { startBackupSchedule, stopBackupSchedule } = await load();
    startBackupSchedule();
    // 触发 7 次
    for (let i = 0; i < 7; i++) {
      void intervalCallbacks[0]!();
      await new Promise((r) => setImmediate(r));
    }
    expect(execSpy).toHaveBeenCalledWith('VACUUM');
    // 日志：VACUUM 完成
    expect(logInfo).toHaveBeenCalledWith('SQLite VACUUM 完成（软删/已删数据物理回收）');
    stopBackupSchedule();
  });

  it('每日 runBackup 失败 → onBackupFailure("每日", err)', async () => {
    const failErr = new Error('permission denied');
    runBackup.mockRejectedValueOnce(failErr);
    const { startBackupSchedule, stopBackupSchedule } = await load();
    startBackupSchedule();
    void intervalCallbacks[0]!();
    await new Promise((r) => setImmediate(r));
    expect(logError).toHaveBeenCalledWith(
      { err: failErr, where: '每日' },
      expect.stringContaining('备份失败')
    );
    expect(captureSpy).toHaveBeenCalledWith(failErr);
    // 即便备份失败，sqliteMaintenance 仍跑（.finally 兜底）
    expect(pragmaSpy).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)');
    stopBackupSchedule();
  });

  it('sqliteMaintenance 内部 pragma 抛错 → warn + 不打断流程', async () => {
    runBackup.mockResolvedValue(undefined);
    // 临时让 pragma 抛错：mock 替换
    const orig = testDb.pragma;
    testDb.pragma = (() => {
      throw new Error('wal checkpoint failed');
    }) as typeof testDb.pragma;
    try {
      const { startBackupSchedule, stopBackupSchedule } = await load();
      startBackupSchedule();
      void intervalCallbacks[0]!();
      await new Promise((r) => setImmediate(r));
      expect(logWarn).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        'SQLite 例行维护失败（不影响服务）'
      );
      stopBackupSchedule();
    } finally {
      testDb.pragma = orig;
    }
  });
});

describe('backup-scheduler onBackupFailure 错误归一化', () => {
  it('非 Error 实例（字符串）也走 Sentry（包成 Error）', async () => {
    runBackup.mockRejectedValueOnce('plain string error');
    const { startBackupSchedule, stopBackupSchedule } = await load();
    startBackupSchedule();
    void timeoutCallbacks[0]!();
    await new Promise((r) => setImmediate(r));
    expect(captureSpy).toHaveBeenCalledWith(expect.any(Error));
    // 包出的 Error 包含 where 标签
    const sentryArg = captureSpy.mock.calls[0]![0] as Error;
    expect(sentryArg.message).toContain('启动');
    stopBackupSchedule();
  });
});
