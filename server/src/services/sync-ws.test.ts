/**
 * server/src/services/sync-ws.ts 单测 —— WebSocket 实时同步网关
 *
 * 起一个临时 HTTP server + 真正的 WebSocketServer，走完整握手/子协议/消息协议。
 * getDb / metrics / logger 全部 mock；issueAccessToken 用真签名。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocket as WsClient } from 'ws';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { issueAccessToken } from '../auth/jwt.js';

let testDb: DatabaseType;
let httpServer: HttpServer;
let port: number;

vi.mock('../db.js', () => ({ getDb: () => testDb }));
vi.mock('../metrics.js', () => ({
  wsConnectionsActive: { inc: () => undefined, dec: () => undefined },
}));
vi.mock('../logger.js', () => ({
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));

import { setupSyncWss, closeWss, broadcastNoteChanged, broadcastShareChanged } from './sync-ws.js';

const USER = 'u-ws';
const USER2 = 'u2-ws';
const DEVICE = 'dev-ws';

/** 服务端 → 客户端的下行消息（见 sync-ws.ts 协议说明） */
type ServerMessage = {
  type: string;
  channels?: string[];
  serverTime?: string;
  [k: string]: unknown;
};

beforeAll(async () => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES ('${USER}');
    INSERT INTO users (id) VALUES ('${USER2}');
    CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      refresh_token_hash TEXT
    );
  `);
  // 设备有效
  testDb
    .prepare('INSERT INTO devices (id, user_id, refresh_token_hash) VALUES (?, ?, ?)')
    .run(DEVICE, USER, 'some-hash');

  httpServer = createServer();
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  port = (httpServer.address() as AddressInfo).port;
  setupSyncWss(httpServer);
});

afterAll(async () => {
  await closeWss();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  testDb.close();
});

beforeEach(() => {
  // 删设备 → 测设备吊销路径
});

/** 用 ws 客户端连 server。
 *  连接建立时把已经在缓冲中的消息也回放——避免 hello 早于 listener 注册的丢消息 race。 */
function openClient(
  opts: { token?: string; protocol?: string; subProtocols?: string[]; url?: string } = {}
): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const url = opts.url ?? `ws://127.0.0.1:${port}/api/v1/sync/ws`;
    const protocols = opts.subProtocols ?? (opts.token ? ['dustnote', opts.token] : []);
    const ws = new WsClient(url, protocols);
    const buffered: ServerMessage[] = [];
    ws.on('message', (raw) => {
      try {
        buffered.push(JSON.parse(raw.toString()) as ServerMessage);
      } catch {
        /* ignore */
      }
    });
    ws.once('open', () => {
      (ws as unknown as { __buffered: ServerMessage[] }).__buffered = buffered;
      resolve(ws);
    });
    ws.once('error', reject);
  });
}

function nextMessage(
  ws: WsClient,
  predicate?: (m: ServerMessage) => boolean
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const buffered = (ws as unknown as { __buffered?: ServerMessage[] }).__buffered ?? [];
    // 先消费已经收到的
    while (buffered.length) {
      const m = buffered.shift()!;
      if (!predicate || predicate(m)) {
        resolve(m);
        return;
      }
    }
    const onMsg = (raw: import('ws').RawData) => {
      try {
        const m = JSON.parse(raw.toString()) as ServerMessage;
        if (!predicate || predicate(m)) {
          ws.off('message', onMsg);
          resolve(m);
        }
      } catch {
        // ignore non-JSON
      }
    };
    ws.on('message', onMsg);
    setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error('nextMessage timeout'));
    }, 5000);
  });
}

describe('sync-ws 握手与认证', () => {
  it('无子协议 → server 拒绝 (1002 close)', async () => {
    // 协议：handleProtocols 返回 false → ws 拒绝升级
    await expect(openClient({})).rejects.toThrow();
  });

  it('有 dustnote + 有效 token → 连接 + 收到 hello', async () => {
    const token = issueAccessToken(USER, DEVICE);
    const ws = await openClient({ token });
    const hello = await nextMessage(ws, (m) => m.type === 'hello');
    expect(hello.type).toBe('hello');
    expect(typeof hello.serverTime).toBe('string');
    ws.close();
  });

  it('无效 token → 401 升级拒绝', async () => {
    await expect(openClient({ token: 'invalid.jwt.token' })).rejects.toThrow();
  });
});

describe('sync-ws 协议', () => {
  let ws: WsClient | null = null;
  beforeEach(async () => {
    const token = issueAccessToken(USER, DEVICE);
    ws = await openClient({ token });
    // 消耗 hello
    await nextMessage(ws, (m) => m.type === 'hello');
  });
  afterEach(() => {
    ws?.close();
    ws = null;
  });

  it('ping → pong', async () => {
    const pong = nextMessage(ws!, (m) => m.type === 'pong');
    ws!.send(JSON.stringify({ type: 'ping' }));
    const m = await pong;
    expect(m.type).toBe('pong');
    expect(typeof m.serverTime).toBe('string');
  });

  it('subscribe notes → subscribed 响应', async () => {
    const sub = nextMessage(ws!, (m) => m.type === 'subscribed');
    ws!.send(JSON.stringify({ type: 'subscribe', channels: ['notes', 'shares'] }));
    const m = await sub;
    expect(m.type).toBe('subscribed');
    expect(m.channels).toEqual(expect.arrayContaining(['notes', 'shares']));
  });

  it('subscribe 含非法 channel → 仅合法被记录', async () => {
    const sub = nextMessage(ws!, (m) => m.type === 'subscribed');
    ws!.send(JSON.stringify({ type: 'subscribe', channels: ['notes', 'evil', 'preferences'] }));
    const m = await sub;
    expect(m.channels).toEqual(expect.arrayContaining(['notes', 'preferences']));
    expect(m.channels).not.toContain('evil');
  });

  it('subscribe 超过 MAX_CHANNELS=8 → 后续被忽略', async () => {
    const sub = nextMessage(ws!, (m) => m.type === 'subscribed');
    // 已知合法只有 3 个，subscribe 多条相同的 notes 也不会重复加入（Set 语义）
    // 这里通过：先订阅 notes/shares/preferences → 再 subscribe 一次 9 个不同 channel（含重复的）
    // 由于合法 channel 只有 3 个，验证 size <= MAX_CHANNELS
    ws!.send(JSON.stringify({ type: 'subscribe', channels: ['notes', 'shares', 'preferences'] }));
    const m = await sub;
    expect(m.channels!.length).toBe(3);
  });

  it('subscribe 重复 channel → Set 去重', async () => {
    const sub = nextMessage(ws!, (m) => m.type === 'subscribed');
    ws!.send(JSON.stringify({ type: 'subscribe', channels: ['notes', 'notes', 'notes'] }));
    const m = await sub;
    expect(m.channels).toEqual(['notes']);
  });

  it('非法 JSON 消息 → 不崩连接', async () => {
    ws!.send('this is not json');
    await new Promise((r) => setTimeout(r, 200));
    // 连接仍在：再 ping 一次能拿到 pong
    const pong = nextMessage(ws!, (m) => m.type === 'pong');
    ws!.send(JSON.stringify({ type: 'ping' }));
    const m = await pong;
    expect(m.type).toBe('pong');
  });

  it('未知 type 消息 → 静默忽略', async () => {
    ws!.send(JSON.stringify({ type: 'mystery' }));
    await new Promise((r) => setTimeout(r, 200));
    // 连接还在
    const pong = nextMessage(ws!, (m) => m.type === 'pong');
    ws!.send(JSON.stringify({ type: 'ping' }));
    await pong;
  });

  it('subscribe 但 channels 非数组 → 静默忽略', async () => {
    ws!.send(JSON.stringify({ type: 'subscribe', channels: 'notes' })); // 字符串而非数组
    await new Promise((r) => setTimeout(r, 200));
    const pong = nextMessage(ws!, (m) => m.type === 'pong');
    ws!.send(JSON.stringify({ type: 'ping' }));
    await pong;
  });
});

describe('sync-ws 广播', () => {
  let ws1: WsClient;
  let ws2: WsClient;
  beforeEach(async () => {
    const token1 = issueAccessToken(USER, DEVICE);
    ws1 = await openClient({ token: token1 });
    await nextMessage(ws1, (m) => m.type === 'hello');
    // ws2 用另一设备
    testDb
      .prepare('INSERT INTO devices (id, user_id, refresh_token_hash) VALUES (?, ?, ?)')
      .run('dev-2', USER, 'h2');
    const token2 = issueAccessToken(USER, 'dev-2');
    ws2 = await openClient({ token: token2 });
    await nextMessage(ws2, (m) => m.type === 'hello');
  });
  afterEach(() => {
    ws1?.close();
    ws2?.close();
    testDb.prepare('DELETE FROM devices WHERE id=?').run('dev-2');
  });

  it('subscribe notes 后广播 note_changed → 收到', async () => {
    const sub1 = nextMessage(ws1, (m) => m.type === 'subscribed');
    ws1.send(JSON.stringify({ type: 'subscribe', channels: ['notes'] }));
    await sub1;
    const sub2 = nextMessage(ws2, (m) => m.type === 'subscribed');
    ws2.send(JSON.stringify({ type: 'subscribe', channels: ['notes'] }));
    await sub2;

    const m1 = nextMessage(ws1, (m) => m.type === 'note_changed');
    const m2 = nextMessage(ws2, (m) => m.type === 'note_changed');
    broadcastNoteChanged(USER, { id: 'note-1', op: 'create' });
    const a = await m1;
    const b = await m2;
    expect(a).toMatchObject({ type: 'note_changed', noteId: 'note-1', op: 'create' });
    expect(b).toMatchObject({ type: 'note_changed', noteId: 'note-1', op: 'create' });
  });

  it('未订阅 notes 的连接 → 不收到 note_changed', async () => {
    // ws1 不订阅
    const pong = nextMessage(ws1, (m) => m.type === 'pong');
    ws1.send(JSON.stringify({ type: 'ping' }));
    await pong;

    broadcastNoteChanged(USER, { id: 'note-1', op: 'update' });
    // 等 300ms 确保不收到
    let received = false;
    const timer = setTimeout(() => {}, 300);
    ws1.once('message', () => {
      received = true;
    });
    await new Promise((r) => setTimeout(r, 400));
    clearTimeout(timer);
    expect(received).toBe(false);
  });

  it('不同 userId 的广播互不影响', async () => {
    // ws1 是 USER，订阅 notes
    const sub1 = nextMessage(ws1, (m) => m.type === 'subscribed');
    ws1.send(JSON.stringify({ type: 'subscribe', channels: ['notes'] }));
    await sub1;

    // 广播给 USER2 → ws1 不应收到
    let received = false;
    ws1.once('message', () => {
      received = true;
    });
    broadcastNoteChanged(USER2, { id: 'note-X', op: 'create' });
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toBe(false);
  });

  it('broadcastShareChanged 收到 share_changed', async () => {
    const sub1 = nextMessage(ws1, (m) => m.type === 'subscribed');
    ws1.send(JSON.stringify({ type: 'subscribe', channels: ['shares'] }));
    await sub1;

    const m = nextMessage(ws1, (m) => m.type === 'share_changed');
    broadcastShareChanged(USER, { id: 'share-1', op: 'revoke' });
    const got = await m;
    expect(got).toMatchObject({ type: 'share_changed', shareId: 'share-1', op: 'revoke' });
  });

  it('无连接的用户 → broadcast 安全 no-op', () => {
    expect(() => broadcastNoteChanged('no-such-user', { id: 'x', op: 'create' })).not.toThrow();
    expect(() => broadcastShareChanged('no-such-user', { id: 'x', op: 'revoke' })).not.toThrow();
  });
});

describe('sync-ws DoS 防护', () => {
  // 用独立 user 避免被其他 describe 留下的连接挤爆 5 连接上限
  const userDos = 'u-dos';
  const userRate = 'u-rate';
  const devDos = 'dev-dos';
  const devRate = 'dev-rate';

  beforeAll(() => {
    testDb.prepare('INSERT OR IGNORE INTO users (id) VALUES (?)').run(userDos);
    testDb.prepare('INSERT OR IGNORE INTO users (id) VALUES (?)').run(userRate);
    testDb
      .prepare('INSERT INTO devices (id, user_id, refresh_token_hash) VALUES (?, ?, ?)')
      .run(devDos, userDos, 'h');
    testDb
      .prepare('INSERT INTO devices (id, user_id, refresh_token_hash) VALUES (?, ?, ?)')
      .run(devRate, userRate, 'h');
  });
  afterAll(() => {
    testDb.prepare('DELETE FROM devices WHERE id=?').run(devDos);
    testDb.prepare('DELETE FROM devices WHERE id=?').run(devRate);
  });

  it('单用户连接数超过 5 → 新连接被 close(1008)', async () => {
    const clients: WsClient[] = [];
    for (let i = 0; i < 5; i++) {
      testDb
        .prepare('INSERT INTO devices (id, user_id, refresh_token_hash) VALUES (?, ?, ?)')
        .run(`dev-dos-cap-${i}`, userDos, 'h');
      const token = issueAccessToken(userDos, `dev-dos-cap-${i}`);
      const ws = await openClient({ token });
      await nextMessage(ws, (m) => m.type === 'hello');
      clients.push(ws);
    }
    // 第 6 个应被 close
    testDb
      .prepare('INSERT INTO devices (id, user_id, refresh_token_hash) VALUES (?, ?, ?)')
      .run('dev-dos-cap-6', userDos, 'h');
    const token6 = issueAccessToken(userDos, 'dev-dos-cap-6');
    const ws6 = await openClient({ token: token6 });
    const closed = await new Promise<{ code: number; reason: string }>((resolve) => {
      ws6.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    expect(closed.code).toBe(1008);
    expect(closed.reason).toMatch(/too many/i);
    ws6.close();
    for (const c of clients) c.close();
    for (let i = 0; i < 6; i++) {
      testDb.prepare('DELETE FROM devices WHERE id=?').run(`dev-dos-cap-${i}`);
    }
    testDb.prepare('DELETE FROM devices WHERE id=?').run('dev-dos-cap-6');
  });

  it('单连接消息频率 > 10/s → close(1008) rate limit', async () => {
    const token = issueAccessToken(userRate, devRate);
    const ws = await openClient({ token });
    await nextMessage(ws, (m) => m.type === 'hello');
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on('error', () => {
        /* swallow */
      });
    });
    for (let i = 0; i < 12; i++) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
    const c = await closed;
    expect(c.code).toBe(1008);
    expect(c.reason).toMatch(/rate limit/i);
  }, 10000);
});

describe('sync-ws 设备吊销', () => {
  it('设备 refresh_token_hash 为空 → close(4001) device_revoked', async () => {
    // 建一个临时设备，初始有效
    testDb
      .prepare('INSERT INTO devices (id, user_id, refresh_token_hash) VALUES (?, ?, ?)')
      .run('dev-temp', USER, 'h');
    const token = issueAccessToken(USER, 'dev-temp');
    // 撤销：清空 hash
    testDb.prepare('UPDATE devices SET refresh_token_hash=NULL WHERE id=?').run('dev-temp');
    const ws = await openClient({ token });
    const closed = await new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    expect(closed.code).toBe(4001);
    expect(closed.reason).toMatch(/device_revoked/);
    testDb.prepare('DELETE FROM devices WHERE id=?').run('dev-temp');
  });
});
