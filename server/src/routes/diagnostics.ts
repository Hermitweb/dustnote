/**
 * 诊断上报接收与查看 — OBS-R03（2026-09-25）
 *
 * 端点：
 * - POST /api/v1/diagnostics/reports （**匿名可达**，单独限流 10/min/IP；仍需 X-Client-* 版本头）
 * - GET  /api/v1/diagnostics?limit=N （鉴权后，查看最近上报，默认 50，上限 200）
 * - DELETE /api/v1/diagnostics        （鉴权后，清空）
 *
 * 为什么接收端匿名：崩溃大多发生在鉴权链路本身（解锁/状态探测——2026-09-24 真机审计
 * 的三个 P1 全在此处），要求登录会恰好丢掉最有价值的样本。
 *
 * 隐私模型（与 web 端 Sentry beforeSend 的思路同源，但按自托管场景取舍）：
 * - 单用户自托管：报告只回到所有者自己的服务器，不跨信任边界，无需 Sentry 式
 *   全量剥离 message（那是给第三方 SaaS 设计的）；
 * - 入库前 sanitizeDiagText 剥离 URL（防查询串带凭据/设备信息）并硬截断
 *   （message ≤600、stack ≤4000）；Hermes/JS 堆栈帧只含函数名与行号，不含正文；
 * - message 理论上可能内嵌用户输入（如把搜索词拼进错误文案），长度截断是兜底；
 *   查看/清空均为所有者本人操作。
 *
 * 保留策略：30 天且最多 2000 行，每批写入后就地修剪（SQLite 单机，无需 cron）。
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';

export const DIAGNOSTICS_PLATFORMS = ['android', 'ios', 'web', 'desktop', 'miniprogram'] as const;

const EventSchema = z.object({
  kind: z.enum(['error', 'rejection', 'network']),
  message: z.string().min(1).max(600),
  stack: z.string().max(4000).optional(),
  platform: z.enum(DIAGNOSTICS_PLATFORMS),
  clientVersion: z.string().min(1).max(40),
  deviceModel: z.string().max(120).optional(),
  osVersion: z.string().max(120).optional(),
});
const BodySchema = z.object({ events: z.array(EventSchema).min(1).max(20) });

/** 文本消毒：URL → [url]，硬截断。空/未给返回 undefined。 */
export function sanitizeDiagText(text: string | undefined | null, max: number): string | undefined {
  if (!text) return undefined;
  return text.replace(/https?:\/\/\S+/g, '[url]').slice(0, max);
}

/** 修剪到保留窗口（30 天 / 2000 行），供写入路径与测试调用 */
export function pruneDiagnostics(): void {
  const db = getDb();
  db.prepare(
    `DELETE FROM diagnostics
     WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')`
  ).run();
  db.prepare(
    `DELETE FROM diagnostics
     WHERE id NOT IN (SELECT id FROM diagnostics ORDER BY id DESC LIMIT 2000)`
  ).run();
}

/** 匿名接收路由（挂在鉴权前，见 app.ts） */
export const diagnosticsIngestRouter = Router();

diagnosticsIngestRouter.post('/diagnostics/reports', (req: Request, res: Response) => {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', message: 'events 需为 1-20 条合法诊断事件' });
    return;
  }
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO diagnostics (kind, message, stack, platform, client_version, device_model, os_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
  );
  let accepted = 0;
  for (const ev of parsed.data.events) {
    const message = sanitizeDiagText(ev.message, 600);
    if (!message) continue; // 消毒后为空的事件没有诊断价值，丢弃
    stmt.run(
      ev.kind,
      message,
      sanitizeDiagText(ev.stack, 4000) ?? null,
      ev.platform,
      ev.clientVersion,
      sanitizeDiagText(ev.deviceModel, 120) ?? null,
      sanitizeDiagText(ev.osVersion, 120) ?? null
    );
    accepted++;
  }
  pruneDiagnostics();
  res.status(202).json({ accepted });
});

/** 鉴权后查看/清理路由（挂在 authMiddleware 之后） */
export const diagnosticsViewRouter = Router();

diagnosticsViewRouter.get('/diagnostics', (req: Request, res: Response) => {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 200) : 50;
  const rows = getDb()
    .prepare(
      `SELECT id, kind, message, stack, platform, client_version, device_model, os_version, created_at
       FROM diagnostics ORDER BY id DESC LIMIT ?`
    )
    .all(limit);
  res.json({ events: rows, count: (rows as unknown[]).length });
});

diagnosticsViewRouter.delete('/diagnostics', (_req: Request, res: Response) => {
  const info = getDb().prepare(`DELETE FROM diagnostics`).run();
  res.json({ cleared: info.changes });
});
