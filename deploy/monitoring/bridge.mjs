/**
 * Alertmanager → ntfy 最小桥（P0-2）
 *
 * 为什么自写：ntfy 的 JSON publish 格式（{topic,title,message,priority,tags}）
 * 与 Alertmanager webhook body（{alerts:[...]})不兼容，社区 bridge 镜像又要
 * 引入新的供应链信任面。30 行内自己转，跑在主栈已有的 node:22-alpine 上。
 *
 * 收 POST /publish（Alertmanager 通知格式）→ 每条 firing/resolved 告警
 * 转成一条 ntfy 消息。NTFY_SERVER/NTFY_TOPIC 由 compose 注入。
 */
const PORT = 9095;
const SERVER = process.env.NTFY_SERVER || 'https://ntfy.sh';
const TOPIC = process.env.NTFY_TOPIC;
if (!TOPIC) {
  console.error('NTFY_TOPIC is required');
  process.exit(1);
}

/** @param {any} a Alertmanager alert item */
async function publishOne(a, resolved) {
  const name = a.labels?.alertname ?? 'Alert';
  const sev = a.labels?.severity ?? 'warning';
  const summary = a.annotations?.summary ?? name;
  const desc = a.annotations?.description ?? '';
  const title = resolved ? `✅ 恢复: ${name}` : `${sev === 'critical' ? '🔴' : '🟠'} ${name}`;
  const message = `${summary}${desc ? `\n${desc}` : ''}`;
  try {
    const res = await fetch(`${SERVER}/${TOPIC}`, {
      method: 'POST',
      headers: {
        Title: encodeURIComponent(title),
        Priority: resolved ? '3' : sev === 'critical' ? '5' : '4',
        Tags: resolved ? 'white_check_mark' : sev === 'critical' ? 'rotating_light' : 'warning',
      },
      body: message,
    });
    if (!res.ok) console.error(`ntfy publish failed: ${res.status} ${await res.text()}`);
  } catch (err) {
    console.error('ntfy publish error:', err?.message ?? err);
  }
}

const server = (await import('node:http')).createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/publish') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
        for (const a of alerts) {
          void publishOne(a, a.status === 'resolved');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (err) {
        console.error('bad webhook payload:', err?.message ?? err);
        res.writeHead(400).end('{}');
      }
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200).end('ok');
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, () => console.log(`alertmanager→ntfy bridge on :${PORT}`));
