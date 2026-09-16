/**
 * GET/POST /api/v1/config/server-endpoint — 服务端登记的规范服务器地址
 *
 * 小程序「部署预置」链路（用户需求 2026-09-17）：
 * - 首次激活的设备把自己连接成功的地址 POST 上来登记（先到先得,幂等）
 * - 之后任何新设备经发布包预置的引导地址 GET 该值,直达解锁页,
 *   免「选模式 + 输地址」;引导地址失效时客户端展示地址失效提示页
 *
 * 信任模型（docs/security-model.md「设置先到先得」同款）：
 * 端点在鉴权前暴露,登记是先到先得——攻击者若赶在所有者之前在**全新库**上
 * 抢注一个恶意地址,新设备会被引导过去。窗口极小且仅影响未初始化的库;
 * 已登记后任何人都无法改写（409）,运维迁移用 SERVER_PUBLIC_URL 环境变量
 * 强制覆盖（见 env.ts）。
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import { config } from '../env.js';

export const serverConfigRouter = Router();

const KEY = 'canonical_server_url';

const BodySchema = z.object({
  serverUrl: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .regex(/^https?:\/\//i, '必须以 http:// 或 https:// 开头'),
});

function readStored(): string | null {
  const row = getDb().prepare(`SELECT value FROM server_config WHERE key = ?`).all(KEY)[0] as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

/** GET /config/server-endpoint：运维覆盖（SERVER_PUBLIC_URL）优先,否则返回登记值 */
export function getServerEndpoint(_req: Request, res: Response): void {
  res.json({ serverUrl: config.serverPublicUrl ?? readStored() });
}

/** POST /config/server-endpoint：登记地址。未登记 → 写入;已登记同值 → 幂等;不同值 → 409 */
export function postServerEndpoint(req: Request, res: Response): void {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', message: 'serverUrl 必须是 http(s) 地址' });
    return;
  }
  const url = parsed.data.serverUrl.replace(/\/+$/, '');
  const existing = readStored();
  if (existing != null && existing !== url) {
    res.status(409).json({ error: 'endpoint_already_set', current: existing });
    return;
  }
  if (existing == null) {
    getDb().prepare(`INSERT INTO server_config (key, value) VALUES (?, ?)`).run(KEY, url);
  }
  res.json({ serverUrl: url });
}

serverConfigRouter.get('/config/server-endpoint', getServerEndpoint);
serverConfigRouter.post('/config/server-endpoint', postServerEndpoint);
