/**
 * 诊断队列测试（OBS-R03 客户端半边）
 *
 * 锁定行为契约：截断/URL 剥离/去重/上限/禁用开关/批量 ≤20/失败保留队列。
 * 队列以 AsyncStorage 为唯一事实源（memQueue 镜像已删——它会丢上一会话积压），
 * 因此用例只需清 storage + 复位 mode，不再 resetModules（resetModules 会让
 * 测试与被测模块拿到不同的 AsyncStorage 单例，是首轮全红的根因）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  api: { post: vi.fn(async () => ({ accepted: 0 })) },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useModeStore } from './mode-store';
import { api } from '../api';
import { enqueueDiagEvent, flushDiagnostics, recordNetworkSignal } from './diagnostics';

const QUEUE_KEY = 'dustnote_diagno…s_v1';
const DISABLED_KEY = 'dustnote_diag_disabled';
const AS = AsyncStorage as unknown as { _store: Map<string, string> };

async function readQueue(): Promise<Array<{ kind: string; message: string }>> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

beforeEach(async () => {
  vi.mocked(api.post).mockReset().mockResolvedValue({ accepted: 0 });
  AS._store.clear();
  useModeStore.setState({
    mode: 'online',
    serverUrl: 'http://test.local',
    initialized: true,
    hydrated: true,
  });
});

describe('入队与隐私处理', () => {
  it('message 截断 600 且剥离 URL（含查询串里的 token）', async () => {
    await enqueueDiagEvent(
      'error',
      `boom at https://api.example.com/x?token=abc ${'x'.repeat(1000)}`
    );
    const q = await readQueue();
    expect(q).toHaveLength(1);
    expect(q[0].message.length).toBeLessThanOrEqual(600);
    expect(q[0].message).not.toContain('token=abc');
    expect(q[0].message).toContain('[url]');
  });

  it('同 kind+message 去重（保留最新一条，队列不膨胀）', async () => {
    await enqueueDiagEvent('error', 'same failure');
    await enqueueDiagEvent('error', 'same failure');
    await enqueueDiagEvent('error', 'same failure');
    expect(await readQueue()).toHaveLength(1);
  });

  it('队列上限 50（溢出丢最旧）', async () => {
    for (let i = 0; i < 60; i++) {
      await enqueueDiagEvent('error', `failure-${i}`);
    }
    const q = await readQueue();
    expect(q).toHaveLength(50);
    expect(q[0].message).toBe('failure-10');
    expect(q[49].message).toBe('failure-59');
  });

  it('禁用开关置位后完全不入队', async () => {
    await AsyncStorage.setItem(DISABLED_KEY, '1');
    await enqueueDiagEvent('error', 'should not appear');
    expect(await readQueue()).toHaveLength(0);
  });
});

describe('flush 回传', () => {
  it('单机模式不回传（无接收方），队列保留', async () => {
    await enqueueDiagEvent('error', 'offline note');
    useModeStore.setState({ mode: 'standalone', serverUrl: null });
    await flushDiagnostics();
    expect(api.post).not.toHaveBeenCalled();
    expect(await readQueue()).toHaveLength(1);
  });

  it('批量 ≤20：25 条先回传最新的 20 条，成功后剩 5 条', async () => {
    for (let i = 0; i < 25; i++) {
      await enqueueDiagEvent('error', `f-${i}`);
    }
    await flushDiagnostics();
    expect(api.post).toHaveBeenCalledTimes(1);
    const body = vi.mocked(api.post).mock.calls[0][1] as {
      events: Array<{ platform: string; clientVersion: string; message: string }>;
    };
    expect(body.events).toHaveLength(20);
    expect(body.events[0].platform).toBe('android');
    expect(body.events[0].clientVersion).toMatch(/^\d+\.\d+\.\d+$/);
    // 发的是最新 20 条（f-5..f-24），留下的最旧 5 条（f-0..f-4）
    const q = await readQueue();
    expect(q).toHaveLength(5);
    expect(q[0].message).toBe('f-0');
    expect(q[4].message).toBe('f-4');
  });

  it('回传失败（网络/429）→ 队列原样保留，下次启动重试', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('429 too many writes'));
    await enqueueDiagEvent('error', 'survive me');
    await flushDiagnostics();
    expect(api.post).toHaveBeenCalledTimes(1);
    const q = await readQueue();
    expect(q).toHaveLength(1);
    expect(q[0].message).toBe('survive me');
  });

  it('recordNetworkSignal 走同一队列（鉴权探测失败的可观测性入口）', async () => {
    recordNetworkSignal('/auth/status failed: AbortError: signal aborted');
    await vi.waitFor(async () => {
      expect(await readQueue()).toHaveLength(1);
    });
    const q = await readQueue();
    expect(q[0].kind).toBe('network');
  });
});
