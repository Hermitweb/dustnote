/**
 * WebSocket 实时同步网关
 *
 * 详见 update-strategy.md §6.3
 * 协议：
 *   Client → Server:
 *     { type: 'ping' }
 *     { type: 'subscribe', channels: ['notes', 'shares', 'preferences'] }
 *   Server → Client:
 *     { type: 'pong', serverTime }
 *     { type: 'note_changed', noteId, op: 'create' | 'update' | 'delete' | 'permanent_delete' }
 *     { type: 'share_changed', shareId, op: 'create' | 'delete' | 'revoke' }
 */

import { WebSocketServer, type WebSocket } from 'ws';
import { verifyToken } from '../auth/jwt.js';
import { getDb } from '../db.js';
import { logger } from '../logger.js';

interface AuthedSocket extends WebSocket {
  userId: string;
  deviceId: string;
  isAlive: boolean;
  channels: Set<string>;
}

// DoS 防护常量
const MAX_PAYLOAD_BYTES = 64 * 1024; // 单帧上限 64KB（ws 默认 100MB，可被单连接灌爆内存）
const MAX_CHANNELS = 8; // 单连接最多订阅频道数
const MAX_MSG_PER_SECOND = 10; // 单连接消息频率上限
const ALLOWED_CHANNELS = new Set(['notes', 'shares', 'preferences']);
const MAX_CONNECTIONS_PER_USER = 5; // 单用户同时活跃 WS 连接数

const clientsByUser = new Map<string, Set<AuthedSocket>>();
let wss: WebSocketServer | null = null;

export function setupSyncWss(httpServer: import('node:http').Server): WebSocketServer {
  if (wss) return wss;

  wss = new WebSocketServer({
    noServer: true,
    path: '/api/v1/sync/ws',
    maxPayload: MAX_PAYLOAD_BYTES,
    // 客户端用子协议 ['dustnote', <token>] 携带 access token。
    // 服务端必须回显客户端已提供的子协议之一，浏览器握手才会成功。
    handleProtocols: (protocols) => (protocols.has('dustnote') ? 'dustnote' : false),
  });

  httpServer.on('upgrade', (req, socket, head) => {
    const reqPath = req.url?.split('?')[0];
    if (reqPath !== '/api/v1/sync/ws') {
      socket.destroy();
      return;
    }

    // 解析 token：通过 Sec-WebSocket-Protocol 子协议携带（"dustnote, <token>"）。
    // 不放 URL query：access token 会原样进入 nginx/Caddy access log，
    // 一旦日志泄露即会话劫持（pino-http 的 URL 脱敏只覆盖 HTTP 链路，upgrade 事件不经它）。
    const protoHeader = req.headers['sec-websocket-protocol'] ?? '';
    const protocols = protoHeader
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const token = protocols[0] === 'dustnote' ? protocols[1] : undefined;
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const payload = verifyToken(token);
    if (!payload || payload.type !== 'access') {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss!.handleUpgrade(req, socket, head, (ws) => {
      // 设备吊销检查：verifyToken 只校验签名，不查库。
      // 设备被吊销后 refresh_token_hash 被清空，但已签发的 access token
      // 在过期前仍有效。这里补一次库查询，阻止被吊销设备建 WS。
      const device = getDb()
        .prepare(
          'SELECT 1 FROM devices WHERE id = ? AND user_id = ? AND refresh_token_hash IS NOT NULL'
        )
        .get(payload.device, payload.sub);
      if (!device) {
        ws.close(4001, 'device_revoked');
        return;
      }
      const authed = ws as AuthedSocket;
      authed.userId = payload.sub;
      authed.deviceId = payload.device;
      authed.isAlive = true;
      authed.channels = new Set();
      wss!.emit('connection', authed, req);
    });
  });

  wss.on('connection', (ws: AuthedSocket) => {
    logger.info({ userId: ws.userId, deviceId: ws.deviceId }, 'WS 连接已建立');

    let set = clientsByUser.get(ws.userId);
    // 单用户连接数限制，防止单账号开大量连接做内存 DoS
    if (set && set.size >= MAX_CONNECTIONS_PER_USER) {
      ws.close(1008, 'too many connections');
      return;
    }
    if (!set) {
      set = new Set();
      clientsByUser.set(ws.userId, set);
    }
    set.add(ws);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // 简单令牌桶限流：每秒最多 MAX_MSG_PER_SECOND 条消息
    let msgCount = 0;
    let msgWindowStart = Date.now();
    ws.on('message', (raw) => {
      const now = Date.now();
      if (now - msgWindowStart >= 1000) {
        msgWindowStart = now;
        msgCount = 0;
      }
      if (++msgCount > MAX_MSG_PER_SECOND) {
        ws.close(1008, 'rate limit');
        return;
      }
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; channels?: string[] };
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', serverTime: new Date().toISOString() }));
        } else if (msg.type === 'subscribe' && Array.isArray(msg.channels)) {
          for (const c of msg.channels) {
            if (
              typeof c === 'string' &&
              c.length <= 32 &&
              ALLOWED_CHANNELS.has(c) &&
              ws.channels.size < MAX_CHANNELS
            ) {
              ws.channels.add(c);
            }
          }
          ws.send(JSON.stringify({ type: 'subscribed', channels: Array.from(ws.channels) }));
        }
      } catch (err) {
        logger.warn({ err }, 'WS 消息解析失败');
      }
    });

    ws.on('close', () => {
      const s = clientsByUser.get(ws.userId);
      s?.delete(ws);
      if (s && s.size === 0) clientsByUser.delete(ws.userId);
      logger.info({ userId: ws.userId }, 'WS 连接已关闭');
    });

    // 初始欢迎
    ws.send(JSON.stringify({ type: 'hello', serverTime: new Date().toISOString() }));
  });

  // 心跳：30s ping 一次，60s 不响应则踢出
  const interval = setInterval(() => {
    wss?.clients.forEach((ws) => {
      const authed = ws as AuthedSocket;
      if (!authed.isAlive) {
        authed.terminate();
        return;
      }
      authed.isAlive = false;
      authed.ping();
    });
  }, 30_000);

  wss.on('close', () => clearInterval(interval));

  return wss;
}

/** 广播笔记变更（来自 notes 路由） */
export function broadcastNoteChanged(userId: string, payload: { id: string; op: string }): void {
  const set = clientsByUser.get(userId);
  if (!set) return;
  const msg = JSON.stringify({
    type: 'note_changed',
    noteId: payload.id,
    op: payload.op,
    serverTime: new Date().toISOString(),
  });
  for (const ws of set) {
    if (ws.readyState === ws.OPEN && ws.channels.has('notes')) {
      ws.send(msg);
    }
  }
}

/** 广播分享变更 */
export function broadcastShareChanged(userId: string, payload: { id: string; op: string }): void {
  const set = clientsByUser.get(userId);
  if (!set) return;
  const msg = JSON.stringify({
    type: 'share_changed',
    shareId: payload.id,
    op: payload.op,
    serverTime: new Date().toISOString(),
  });
  for (const ws of set) {
    if (ws.readyState === ws.OPEN && ws.channels.has('shares')) {
      ws.send(msg);
    }
  }
}

/** 优雅关闭 */
export async function closeWss(): Promise<void> {
  if (!wss) return;
  for (const ws of wss.clients) ws.terminate();
  await new Promise<void>((resolve) => wss!.close(() => resolve()));
  wss = null;
}
