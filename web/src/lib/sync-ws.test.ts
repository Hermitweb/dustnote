/**
 * web/src/lib/sync-ws.ts 单测
 *
 * 覆盖 wsUrl 协议/https 推导、message 路由（note_changed 增量去重 / share_changed 全量防抖）、
 * startSyncWs（无 token 早退 / 构造抛错走重连 / open 后 flush+subscribe+loadAll+setOnline）、
 * close→scheduleReconnect 指数退避、stopSyncWs 清定时器。
 *
 * 策略：mock 掉 ./device / ./store / ./mode-store 三个依赖 + 全局 WebSocket，
 * 用 vi.resetModules + 动态 import 拿到每个用例独立的模块状态，fake timers 推进 300ms 防抖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Listener = (ev?: unknown) => void;

/** WebSocket 工厂 mock：记录构造 url、记录 addEventListener 监听，供用例手动触发 */
function makeWsFactory() {
  const instances: any[] = [];
  const urlLog: string[] = [];
  const Factory = class MockWebSocket {
    url: string;
    sent: unknown[] = [];
    private listeners: Record<string, Listener[]> = {};
    closed = false;
    constructor(url: string) {
      this.url = url;
      urlLog.push(url);
      instances.push(this);
    }
    addEventListener(type: string, fn: Listener) {
      (this.listeners[type] ??= []).push(fn);
    }
    removeEventListener(type: string, fn: Listener) {
      this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== fn);
    }
    send(data: unknown) {
      this.sent.push(data);
    }
    close() {
      this.closed = true;
    }
    fire(type: string, ev?: unknown) {
      for (const fn of this.listeners[type] ?? []) fn(ev);
    }
  };
  return { Factory, instances, urlLog };
}

// store / mode-store / device 的 mock 句柄
let storeMock: any;
let modeMock: any;
let deviceMock: any;

function mockDeps() {
  storeMock = {
    accessToken: 'tok-1',
    loadAll: vi.fn().mockResolvedValue(undefined),
    applyRemoteNoteChanges: vi.fn().mockResolvedValue(undefined),
    flushQueue: vi.fn().mockResolvedValue(undefined),
    setOnline: vi.fn(),
    getState: undefined as unknown,
  };
  storeMock.getState = () => storeMock;

  modeMock = {
    serverUrl: '' as string,
    getState: undefined as unknown,
  };
  modeMock.getState = () => modeMock;

  deviceMock = {
    getDeviceId: vi.fn().mockReturnValue('device-1234'),
  };

  vi.doMock('./device', () => ({
    getDeviceId: (...a: unknown[]) => deviceMock.getDeviceId(...a),
  }));
  vi.doMock('./store', () => ({
    useStore: storeMock,
  }));
  vi.doMock('./mode-store', () => ({
    useModeStore: modeMock,
  }));
}

async function importFresh() {
  return import('./sync-ws');
}

describe('sync-ws.wsUrl 协议推导（通过 startSyncWs 的构造 URL 体现）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockDeps();
  });
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('http origin → ws: 协议', async () => {
    const ws = makeWsFactory();
    vi.stubGlobal('WebSocket', ws.Factory);
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', host: 'localhost:5173' },
      writable: true,
      configurable: true,
    });
    modeMock.serverUrl = '';
    const mod = await importFresh();
    mod.startSyncWs();
    expect(ws.urlLog[0]).toBe(
      'ws://localhost:5173/api/v1/sync/ws?v=0.0.0-test&platform=web&deviceId=device-1234'
    );
  });

  it('配置 serverUrl=https → wss: 协议', async () => {
    const ws = makeWsFactory();
    vi.stubGlobal('WebSocket', ws.Factory);
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', host: 'localhost:5173' },
      writable: true,
      configurable: true,
    });
    modeMock.serverUrl = 'https://dust.example.com/';
    const mod = await importFresh();
    mod.startSyncWs();
    expect(ws.urlLog[0]).toBe(
      'wss://dust.example.com/api/v1/sync/ws?v=0.0.0-test&platform=web&deviceId=device-1234'
    );
  });

  it('无 access token → 早退，不构造 WebSocket', async () => {
    const ws = makeWsFactory();
    vi.stubGlobal('WebSocket', ws.Factory);
    storeMock.accessToken = null;
    const mod = await importFresh();
    mod.startSyncWs();
    expect(ws.instances.length).toBe(0);
  });
});

describe('sync-ws.message 路由', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockDeps();
  });
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('note_changed → 增量 applyRemoteNoteChanges（300ms 防抖 + 按 noteId 去重）', async () => {
    const ws = makeWsFactory();
    vi.stubGlobal('WebSocket', ws.Factory);
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', host: 'h' },
      writable: true,
      configurable: true,
    });
    const mod = await importFresh();
    mod.startSyncWs();
    const inst = ws.instances[0];

    inst.fire('message', {
      data: JSON.stringify({ type: 'note_changed', noteId: 'n1', op: 'update' }),
    });
    inst.fire('message', {
      data: JSON.stringify({ type: 'note_changed', noteId: 'n2', op: 'create' }),
    });
    // 同 noteId 后到 op 覆盖前
    inst.fire('message', {
      data: JSON.stringify({ type: 'note_changed', noteId: 'n1', op: 'delete' }),
    });

    expect(storeMock.applyRemoteNoteChanges).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(storeMock.applyRemoteNoteChanges).toHaveBeenCalledTimes(1);
    const batch = storeMock.applyRemoteNoteChanges.mock.calls[0][0];
    expect(batch.length).toBe(2);
    // 去重后 n1=delete（后到覆盖）
    expect(batch).toEqual([
      ['n1', 'delete'],
      ['n2', 'create'],
    ]);
  });

  it('share_changed → 全量 loadAll（300ms 防抖，多次只拉一次）', async () => {
    const ws = makeWsFactory();
    vi.stubGlobal('WebSocket', ws.Factory);
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', host: 'h' },
      writable: true,
      configurable: true,
    });
    const mod = await importFresh();
    mod.startSyncWs();
    const inst = ws.instances[0];

    inst.fire('message', { data: JSON.stringify({ type: 'share_changed', shareId: 's1' }) });
    inst.fire('message', { data: JSON.stringify({ type: 'share_changed', shareId: 's2' }) });
    expect(storeMock.loadAll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(storeMock.loadAll).toHaveBeenCalledTimes(1);
  });

  it('非法 JSON message → 静默忽略（不抛）', async () => {
    const ws = makeWsFactory();
    vi.stubGlobal('WebSocket', ws.Factory);
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', host: 'h' },
      writable: true,
      configurable: true,
    });
    const mod = await importFresh();
    mod.startSyncWs();
    const inst = ws.instances[0];
    expect(() => inst.fire('message', { data: 'not-json' })).not.toThrow();
  });
});

describe('sync-ws.startSyncWs open 生命周期', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockDeps();
  });
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('open → flushQueue 后 subscribe + loadAll + setOnline(true)', async () => {
    const ws = makeWsFactory();
    vi.stubGlobal('WebSocket', ws.Factory);
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', host: 'h' },
      writable: true,
      configurable: true,
    });
    const mod = await importFresh();
    mod.startSyncWs();
    const inst = ws.instances[0];

    inst.fire('open');
    // flushQueue 是 mockResolvedValue，.finally 同步微任务后触发
    await vi.advanceTimersByTimeAsync(0);
    expect(storeMock.flushQueue).toHaveBeenCalledTimes(1);
    expect(JSON.parse(inst.sent[0])).toEqual({ type: 'subscribe', channels: ['notes', 'shares'] });
    expect(storeMock.loadAll).toHaveBeenCalledTimes(1);
    expect(storeMock.setOnline).toHaveBeenCalledWith(true);
  });

  it('WebSocket 构造抛错 → scheduleReconnect（不抛给调用方）', async () => {
    const throwing = class {
      constructor() {
        throw new Error('csp-block');
      }
    };
    vi.stubGlobal('WebSocket', throwing);
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', host: 'h' },
      writable: true,
      configurable: true,
    });
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await importFresh();
    expect(() => mod.startSyncWs()).not.toThrow();
    // close 监听未注册（构造失败），reconnect 定时器已被排
    await vi.advanceTimersByTimeAsync(5000);
    // 重连再次 startSyncWs，此时 WebSocket 仍抛错 → 再次排（reconnectAttempts 递增）
    expect(warn).toHaveBeenCalled();
  });
});

describe('sync-ws 重连指数退避 + stopSyncWs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockDeps();
  });
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('close → scheduleReconnect：5s 后若仍有 token 则重启（构造新连接）', async () => {
    const ws = makeWsFactory();
    vi.stubGlobal('WebSocket', ws.Factory);
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', host: 'h' },
      writable: true,
      configurable: true,
    });
    const mod = await importFresh();
    mod.startSyncWs();
    expect(ws.instances.length).toBe(1);
    ws.instances[0].fire('close');
    await vi.advanceTimersByTimeAsync(5000);
    expect(ws.instances.length).toBe(2);
  });

  it('stopSyncWs → 解绑 close/error + 清 reconnect/防抖定时器（不复活旧连接）', async () => {
    const ws = makeWsFactory();
    vi.stubGlobal('WebSocket', ws.Factory);
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', host: 'h' },
      writable: true,
      configurable: true,
    });
    const mod = await importFresh();
    mod.startSyncWs();
    const inst = ws.instances[0];
    inst.fire('close'); // 排了 reconnect 定时器
    mod.stopSyncWs();
    // stopSyncWs 清了 reconnectTimer + ws 置空 → 推进 5s 不会再 new 连接
    await vi.advanceTimersByTimeAsync(60000);
    expect(ws.instances.length).toBe(1);
    expect(inst.closed).toBe(true);
  });
});
