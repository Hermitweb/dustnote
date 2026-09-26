/**
 * Alertmanager → ntfy 最小桥（P0-2）
 *
 * 为什么自写：ntfy 的 JSON publish 格式（{topic,title,message,priority,tags}）
 * 与 Alertmanager webhook body（{alerts:[...]})不兼容，社区 bridge 镜像又要
 * 引入新的供应链信任面。30 行内自己转，跑在主栈已有的 node:22-alpine 上。
 *
 * 收 POST /publish（Alertmanager 通知格式）→ 每条 firing/resolved 告警
 * 转成一条 ntfy 消息。NTFY_SERVER/NTFY_TOPIC 由 compose 注入。
 *
 * **投递必须可证明**（这是"真接"与"配置接好了"的分界）：
 *   - 全部推送失败时回 502，让 Alertmanager 按自己的重试策略再投；
 *     原先无论成败都回 {"ok":true}，等于 topic 填错、ntfy 宕机时**静默丢告警**。
 *   - GET /stats 暴露 received/published/failed 与最后一次错误，
 *     演练脚本据此断言"最后一跳真的发出去了"，而不是靠人看手机。
 */
const PORT = 9095;
const SERVER = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '');
const TOPIC = process.env.NTFY_TOPIC;

export const stats = { received: 0, published: 0, failed: 0, lastError: null, lastAt: null };

/**
 * Alertmanager webhook 载荷 → ntfy 消息列表（纯函数，单独有测试）
 *
 * 优先级：resolved=3（不打扰）、critical=5（响）、其它=4；
 * 标题里的符号是 ASCII 的 [!!]/[ok]：ntfy 的 tag 字段才管 emoji，
 * 标题里塞 emoji 在不同客户端字体下会变豆腐块。
 */
export function toNtfyMessages(payload) {
  const alerts = Array.isArray(payload?.alerts) ? payload.alerts : [];
  return alerts.map((a) => {
    const name = a?.labels?.alertname ?? 'Alert';
    const sev = a?.labels?.severity ?? 'warning';
    const resolved = a?.status === 'resolved' || a?.resolved === true;
    const summary = a?.annotations?.summary ?? name;
    const desc = a?.annotations?.description ?? '';
    return {
      alertname: name,
      resolved,
      title: resolved ? `[ok] 恢复: ${name}` : `[${sev === 'critical' ? '!!' : '*'}] ${name}`,
      message: `${summary}${desc ? `\n${desc}` : ''}`.slice(0, 4096),
      priority: resolved ? '3' : sev === 'critical' ? '5' : '4',
      tags: resolved ? 'white_check_mark' : sev === 'critical' ? 'rotating_light' : 'warning',
    };
  });
}

async function publishOne(m) {
  const res = await fetch(`${SERVER}/${TOPIC}`, {
    method: 'POST',
    headers: {
      Title: encodeURIComponent(m.title),
      Priority: m.priority,
      Tags: m.tags,
    },
    body: m.message,
  });
  if (!res.ok) throw new Error(`ntfy ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** 推送一批；返回成功条数（失败逐条记 lastError，不抛） */
export async function publishAll(payload) {
  const msgs = toNtfyMessages(payload);
  let ok = 0;
  for (const m of msgs) {
    try {
      await publishOne(m);
      ok += 1;
      stats.published += 1;
    } catch (err) {
      stats.failed += 1;
      stats.lastError = `${m.alertname}: ${err?.message ?? err}`;
      console.error('ntfy publish failed:', stats.lastError);
    }
  }
  return { attempted: msgs.length, ok };
}

/**
 * 只在被 import 时导出纯函数，直接运行时才起服务 ——
 * 否则 `node --test` 导入这个文件会顺手监听端口并因缺 topic 退出。
 */
const invokedDirectly =
  process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;

if (invokedDirectly) {
  if (!TOPIC) {
    console.error('NTFY_TOPIC is required');
    process.exit(1);
  }
  const http = (await import('node:http')).default;
  http
    .createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/publish') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          let payload;
          try {
            payload = JSON.parse(body || '{}');
          } catch (err) {
            console.error('bad webhook payload:', err?.message ?? err);
            res.writeHead(400).end('{}');
            return;
          }
          stats.received += 1;
          stats.lastAt = new Date().toISOString();
          const { attempted, ok } = await publishAll(payload);
          /* 一条都没推出去却告诉 Alertmanager"成功"，等于把告警扔进黑洞：
             回 502 让它按重试策略再投（空通知 attempted=0 不算失败） */
          const hardFail = attempted > 0 && ok === 0;
          res
            .writeHead(hardFail ? 502 : 200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ ok: !hardFail, attempted, delivered: ok }));
        });
        return;
      }
      if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/stats')) {
        const json = req.url === '/stats' ? JSON.stringify({ ...stats, server: SERVER }) : 'ok';
        res
          .writeHead(200, {
            'content-type': req.url === '/stats' ? 'application/json' : 'text/plain',
          })
          .end(json);
        return;
      }
      res.writeHead(404).end();
    })
    .listen(PORT, () => console.log(`alertmanager→ntfy bridge on :${PORT}`));
}
