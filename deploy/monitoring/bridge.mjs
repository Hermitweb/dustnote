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
 *   - 所有目标都没推出去时回 502，让 Alertmanager 按自己的重试策略再投；
 *     原先无论成败都回 {"ok":true}，等于 topic 填错、ntfy 宕机时**静默丢告警**。
 *   - GET /stats 暴露 received/published/failed/partial 与逐目标计数，
 *     演练脚本据此断言"最后一跳真的发出去了"，而不是靠人看手机。
 *
 * **NTFY_SERVER 支持逗号分隔多目标**（2026-10-02 加）。动因不是锦上添花，是当时的
 * 现场：自托管 ntfy 的公网入口要等一条 DNS A 记录（*.iniess.cn 泛解析指向另一台
 * 154.217.234.79），而告警链路必须今天就可用。于是同时投「自托管 + 公网」两个目标，
 * 一条消息只要 ≥1 个目标成功就算送达；部分失败计入 partial 并在 /stats 里逐目标可见，
 * 不会出现"公网那路通了就以为两条都通"。DNS 记录补齐后把公网那项摘掉即可，无需改代码。
 */
const PORT = 9095;

/** NTFY_SERVER 原始串 → 目标列表（去空、去尾斜杠；空则回落公网默认） */
export function parseServers(raw) {
  const list = String(raw ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return list.length > 0 ? list : ['https://ntfy.sh'];
}

const SERVERS = parseServers(process.env.NTFY_SERVER);
const TOPIC = process.env.NTFY_TOPIC;

export const stats = {
  received: 0,
  published: 0, // 成功的「消息 × 目标」次数（双目标全通 = 一条告警 +2）
  failed: 0, // 失败的「消息 × 目标」次数
  partial: 0, // 送达了但至少一个目标失败的消息条数
  lastError: null,
  lastAt: null,
  /** 逐目标账本：{ 'https://ntfy.sh': { published, failed, lastError } } */
  byTarget: {},
};

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

function targetBook(server) {
  if (!stats.byTarget[server])
    stats.byTarget[server] = { published: 0, failed: 0, lastError: null };
  return stats.byTarget[server];
}

/** 一条消息投所有目标；返回成功的目标数（失败逐目标记账，不抛） */
async function publishToTargets(m, servers, topic, transport) {
  let ok = 0;
  for (const server of servers) {
    const book = targetBook(server);
    try {
      const res = await transport(`${server}/${topic}`, {
        method: 'POST',
        headers: {
          Title: encodeURIComponent(m.title),
          Priority: m.priority,
          Tags: m.tags,
        },
        body: m.message,
      });
      if (!res.ok) throw new Error(`ntfy ${res.status} ${String(await res.text()).slice(0, 200)}`);
      ok += 1;
      book.published += 1;
      stats.published += 1;
    } catch (err) {
      book.failed += 1;
      stats.failed += 1;
      book.lastError = `${m.alertname}: ${err?.message ?? err}`;
      stats.lastError = `${server} -> ${book.lastError}`;
      console.error('ntfy publish failed:', stats.lastError);
    }
  }
  if (ok > 0 && ok < servers.length) stats.partial += 1;
  return ok;
}

/**
 * 推送一批。
 *
 * delivered = 至少送达一个目标的消息条数（502 判据用它，不是 published）：
 * 双目标下一条告警会让 published +2，用它判"有没有通"会把"只通一路"读成全通。
 * servers/topic/transport 可注入，测试因此不必真起一个 ntfy。
 */
export async function publishAll(payload, opts = {}) {
  const servers = opts.servers ?? SERVERS;
  const topic = opts.topic ?? TOPIC;
  const transport = opts.transport ?? ((url, init) => globalThis.fetch(url, init));
  const msgs = toNtfyMessages(payload);
  let delivered = 0;
  for (const m of msgs) {
    if ((await publishToTargets(m, servers, topic, transport)) > 0) delivered += 1;
  }
  return { attempted: msgs.length, delivered, targets: servers.length };
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
          const { attempted, delivered, targets } = await publishAll(payload);
          /* 一个目标都没推出去却告诉 Alertmanager"成功"，等于把告警扔进黑洞：
             回 502 让它按重试策略再投（空通知 attempted=0 不算失败） */
          const hardFail = attempted > 0 && delivered === 0;
          res
            .writeHead(hardFail ? 502 : 200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ ok: !hardFail, attempted, delivered, targets }));
        });
        return;
      }
      if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/stats')) {
        const json = req.url === '/stats' ? JSON.stringify({ ...stats, servers: SERVERS }) : 'ok';
        res
          .writeHead(200, {
            'content-type': req.url === '/stats' ? 'application/json' : 'text/plain',
          })
          .end(json);
        return;
      }
      res.writeHead(404).end();
    })
    .listen(PORT, () =>
      console.log(`alertmanager→ntfy bridge on :${PORT} -> ${SERVERS.join(', ')}`)
    );
}
