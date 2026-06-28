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
import { logger } from '../logger.js';

interface AuthedSocket extends WebSocket {
  userId: string;
  deviceId: string;
  isAlive: boolean;
  channels: Set<string>;
}

const clientsByUser = new Map<string, Set<AuthedSocket>>();
let wss: WebSocketServer | null = null;

export function setupSyncWss(httpServer: import('node:http').Server): WebSocketServer {
  if (wss) return wss;

  wss = new WebSocketServer({ noServer: true, path: '/api/v1/sync/ws' });

  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/api/v1/sync/ws')) {
      socket.destroy();
      return;
    }

    // 解析 token：从 query ?token=xxx 或从 Cookie mn_refresh
    const url = new URL(req.url, 'http://localhost');
    const tokenParam = url.searchParams.get('token');
    const cookieHeader = req.headers.cookie ?? '';
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map((p) => {
        const idx = p.indexOf('=');
        if (idx < 0) return [p.trim(), ''];
        return [p.slice(0, idx).trim(), decodeURIComponent(p.slice(idx + 1).trim())];
      })
    );

    const token = tokenParam ?? cookies.mn_refresh;
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const payload = verifyToken(token);
    if (!payload) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss!.handleUpgrade(req, socket, head, (ws) => {
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
    if (!set) {
      set = new Set();
      clientsByUser.set(ws.userId, set);
    }
    set.add(ws);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; channels?: string[] };
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', serverTime: new Date().toISOString() }));
        } else if (msg.type === 'subscribe' && Array.isArray(msg.channels)) {
          msg.channels.forEach((c) => ws.channels.add(c));
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
