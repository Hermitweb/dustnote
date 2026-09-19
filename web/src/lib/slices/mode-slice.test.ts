/**
 * Mode Slice / Mode Store 守卫回归（审计 ARCH-003）
 *
 * 覆盖模式切换的三个关键分支：
 * - 未初始化 → 拒绝
 * - 未解锁但有单机数据 → 引导先解锁（防数据孤儿）
 * - fresh switch / 已解锁切换 → 状态迁移与密钥清理
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { hasModeDefaultApplied, markModeDefaultApplied, useModeStore } from '../mode-store';

describe('mode-store 首访默认标记', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('mark 前 false，mark 后 true（resetMode 后不会重新强拉联机）', () => {
    expect(hasModeDefaultApplied()).toBe(false);
    markModeDefaultApplied();
    expect(hasModeDefaultApplied()).toBe(true);
  });
});

describe('mode-slice switchMode 守卫', () => {
  beforeEach(() => {
    localStorage.clear();
    useModeStore.setState({
      mode: 'standalone',
      serverUrl: null,
      initialized: true,
    } as Partial<{
      mode: 'standalone' | 'online';
      serverUrl: string | null;
      initialized: boolean;
    }>);
    useStore.setState({
      mode: 'standalone',
      repository: {} as never,
      checkStatus: vi.fn().mockResolvedValue(undefined),
      masterKey: null,
      localAuthBlob: null,
      accessToken: null,
      authState: 'unknown',
      notes: new Map(),
      notesPlain: new Map(),
    } as never);
  });

  it('repository 未初始化时拒绝切换', async () => {
    useStore.setState({ repository: null } as never);
    await expect(useStore.getState().switchMode('online')).rejects.toThrow('尚未初始化');
  });

  it('单机有本地数据且未解锁 → 引导先解锁（防数据孤儿）', async () => {
    useStore.setState({ localAuthBlob: {} as never } as never);
    await expect(useStore.getState().switchMode('online')).rejects.toThrow('请先解锁');
    // 未发生任何模式变更
    expect(useModeStore.getState().mode).toBe('standalone');
  });

  it('无数据 fresh switch 到联机：切模式 + 置 authState=unknown + 通知 checkStatus', async () => {
    await useStore.getState().switchMode('online', 'http://192.168.1.10:8080');
    expect(useModeStore.getState().mode).toBe('online');
    expect(useModeStore.getState().serverUrl).toBe('http://192.168.1.10:8080');
    expect(useStore.getState().mode).toBe('online');
    expect(useStore.getState().authState).toBe('unknown');
    expect(useStore.getState().checkStatus).toHaveBeenCalledTimes(1);
  });

  it('已解锁切换：清空 masterKey/笔记明文（单机数据保留在本机库，不做自动迁移）', async () => {
    useStore.setState({
      masterKey: {} as never,
      localAuthBlob: {} as never,
      notes: new Map([['n1', {} as never]]),
      notesPlain: new Map([['n1', {} as never]]),
    } as never);
    await useStore.getState().switchMode('standalone');
    expect(useStore.getState().masterKey).toBeNull();
    expect(useStore.getState().notes.size).toBe(0);
    expect(useStore.getState().notesPlain.size).toBe(0);
    expect(useStore.getState().accessToken).toBeNull();
  });
});
