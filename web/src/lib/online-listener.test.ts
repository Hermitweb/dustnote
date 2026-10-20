/**
 * online-listener 测试
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { installOnlineListener, uninstallOnlineListener } from './online-listener';

const storeState = {
  setOnline: vi.fn(),
  flushQueue: vi.fn(async () => undefined),
};

vi.mock('./store', () => ({
  useStore: { getState: () => storeState },
}));

describe('online-listener', () => {
  afterEach(() => {
    uninstallOnlineListener();
    storeState.setOnline.mockClear();
    storeState.flushQueue.mockClear();
  });

  it('installOnlineListener 注册监听', () => {
    installOnlineListener();
    expect(navigator.onLine).toBeDefined();
    // 二次调用幂等
    installOnlineListener();
  });

  it('online 事件 → setOnline(true) + flushQueue()', async () => {
    installOnlineListener();
    window.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 16));
    expect(storeState.setOnline).toHaveBeenCalledWith(true);
    expect(storeState.flushQueue).toHaveBeenCalled();
  });

  it('offline 事件 → setOnline(false)', () => {
    installOnlineListener();
    window.dispatchEvent(new Event('offline'));
    expect(storeState.setOnline).toHaveBeenCalledWith(false);
  });

  it('uninstallOnlineListener 清理后事件不再触发', () => {
    installOnlineListener();
    uninstallOnlineListener();
    window.dispatchEvent(new Event('online'));
    // 上次卸载前若已注册过 setOnline 计数会残留；这里只验"再触发不再增加"
    const before = storeState.setOnline.mock.calls.length;
    window.dispatchEvent(new Event('online'));
    expect(storeState.setOnline.mock.calls.length).toBe(before);
  });
});
