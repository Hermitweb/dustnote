#!/usr/bin/env node
/**
 * 服务状态拨测（roadmap P0-1 / P0-2，2026-09-25）
 *
 * 存在的原因：docs/status.md 的 🟢 此前由「发版动作」间接刷绿（bump 脚本归一
 * 日期），不是探测结果——状态页自证清白的方式只有一个：内容由探针生成。
 *
 * 用法：
 *   node scripts/status-probe.mjs              # 探测，输出 JSON，失败 exit 1
 *   node scripts/status-probe.mjs --update     # 同时把结果写进 docs/status.md
 *   STATUS_PROBE_URL=... EXPECT_VERSION=... node scripts/status-probe.mjs
 *
 * 版本基准：默认取根 package.json.version（= 本仓库期望的线上版本）；
 * CI nightly 里即用它发现「线上落后于仓库发布」。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_BASE = (process.env.STATUS_PROBE_URL || 'https://napi.iniess.cn').replace(/\/+$/, '');
const UPDATE = process.argv.includes('--update');
const TIMEOUT_MS = 15_000;
const MARK_START = '<!-- status-probe:start -->';
const MARK_END = '<!-- status-probe:end -->';

const expected =
  process.env.EXPECT_VERSION ||
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

// 服务端 version-check 中间件要求客户端头（缺则 400 missing_client_headers，
// 2026-09-24 发版验收实测）——探针以"最新客户端"身份拨测
const CLIENT_HEADERS = {
  'X-Client-Version': expected,
  'X-Client-Platform': 'web',
  'X-Client-Channel': 'stable',
  'X-Client-Device-Id': 'dustnote-status-probe-0001',
};

async function probe(name, path, check, headers) {
  const started = Date.now();
  try {
    const res = await fetch(`${URL_BASE}${path}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });
    const ms = Date.now() - started;
    const body = res.ok ? await res.text() : null;
    const err = check(res, body);
    return { name, ok: !err, ms, status: res.status, note: err ?? undefined };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - started, note: String(err?.message ?? err) };
  }
}

const results = [];
/** 计入红绿的硬失败；informational 项只记录不判红 */
const hard = [];

let lastHealthVersion = null;

// 1) health：结构 + 版本断言（health 在 version-check 白名单，免头）
results.push(
  await probe('health', '/api/v1/health', (res, body) => {
    if (!res.ok) return `HTTP ${res.status}`;
    let j = null;
    try {
      j = JSON.parse(body ?? '');
    } catch {
      return 'health 非 JSON';
    }
    if (j.ok !== true) return 'health.ok 非 true';
    if (j.db !== 'ok') return `db=${j.db}`;
    if (j.version !== expected) return `线上版本 ${j.version} ≠ 期望 ${expected}`;
    lastHealthVersion = j.version;
    return null;
  })
);
results[results.length - 1].version = lastHealthVersion;

// 2) 更新清单（需客户端头）
results.push(
  await probe(
    'update-manifest',
    '/api/v1/update-manifest',
    (res, body) => {
      if (!res.ok) return `HTTP ${res.status}`;
      try {
        const j = JSON.parse(body ?? '');
        if (!j.latest?.version) return '缺 latest.version';
      } catch {
        return 'manifest 非 JSON';
      }
      return null;
    },
    CLIENT_HEADERS
  )
);

// 3) Web 首页可达
results.push(await probe('web', '/', (res) => (res.ok ? null : `HTTP ${res.status}`)));

// 3.5) 分享服务的**公开 API**（不是 SPA 外壳）：
//   /s/<token> 对任意路径都回 200 首页，拨它等于什么都没测；
//   打 /api/v1/share/public/<假 token> 才有意义 —— 路由活着会回 4xx JSON，5xx 才算坏。
results.push(
  await probe('share-api', '/api/v1/share/public/statusprobe000000000000000', (res) => {
    if (res.status >= 500) return `HTTP ${res.status}`;
    return null;
  })
);

// 4) 明文 HTTP 收口状况——informational（不计入 ok）：
//    R1「强制 HTTPS」落地前明文可达是已知现状，红它 = 制造告警疲劳
try {
  const res = await fetch(URL_BASE.replace(/^https:/, 'http:') + '/api/v1/health', {
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const hardened = [301, 302, 307, 308].includes(res.status) || res.status === 404;
  results.push({
    name: 'http-plaintext(informational)',
    informational: true,
    ok: true,
    ms: 0,
    status: res.status,
    note: hardened ? '明文已收口' : `明文仍可服务（status=${res.status}，R1 HTTPS 收口待办）`,
  });
} catch (err) {
  results.push({
    name: 'http-plaintext(informational)',
    informational: true,
    ok: true,
    ms: 0,
    note: `明文不可达：${String(err?.message ?? err)}`,
  });
}

const allOk = hard.every((r) => r.ok);
const liveVersion = results.find((r) => r.name === 'health')?.version ?? null;
const report = {
  at: new Date().toISOString(),
  url: URL_BASE,
  expected,
  liveVersion,
  ok: allOk,
  results,
};
console.log(JSON.stringify(report, null, 2));

if (UPDATE) {
  /**
   * 状态页的「当前状态」整段由本探针生成。
   *
   * 为什么要生成而不是手写：这一页存在的唯一意义是"外部可核实的线上事实"。
   * 手写就会同时满足两个坏条件——发版脚本顺手刷绿（v2.5.43 时页面还停在 2.5.40）、
   * 组件表里的 🟢 与真实探测无关（本次实测到页头是 🔴、表内六行全是 🟢 的自相矛盾）。
   * 现在发版脚本只允许写「客户端渠道表」（那是"我们发布了什么"的事实），
   * "线上是什么"只能由探测结果落笔。
   */
  const statusPath = join(ROOT, 'docs/status.md');
  const md = readFileSync(statusPath, 'utf8');
  const stamp = report.at.slice(0, 16).replace('T', ' ');
  const rows = results
    .map((r) => {
      const flag = r.informational ? 'ℹ️' : r.ok ? '✅' : '❌';
      const note = (r.note ?? '').replace(/\|/g, '/');
      return `| ${r.name} | ${flag} | ${r.ms}ms | ${r.status ?? '-'} | ${note} |`;
    })
    .join('\n');
  const generated = [
    MARK_START,
    `> 最近拨测：${stamp} UTC · ${allOk ? '🟢 全部通过' : '🔴 有失败项'} · 期望版本 v${expected}`,
    '',
    allOk
      ? `**当前状态：🟢 正常** — 线上 **v${liveVersion ?? expected}**（探针判定，非人工声明）`
      : `**当前状态：🔴 异常** — 线上 **v${liveVersion ?? '未知'}**，期望 v${expected}（明细见下表；复现：\`node scripts/status-probe.mjs\`）`,
    '',
    '| 探测项 | 结果 | 耗时 | HTTP | 说明 |',
    '| --- | --- | --- | --- | --- |',
    rows,
    '',
    '_未列入本表的组件（WebSocket 同步、/metrics）探针不覆盖，状态见下方「拨测不覆盖的部分」。_',
    MARK_END,
  ].join('\n');
  const next = md.replace(
    new RegExp(`${MARK_START}[\\s\\S]*${MARK_END}`),
    generated.replace(/\$/g, '$$$$')
  );
  if (next === md) {
    console.error('docs/status.md 缺少探针标记，未写入');
  } else {
    writeFileSync(statusPath, next);
    console.error(`docs/status.md 已按拨测结果更新（${allOk ? '绿' : '红'}）`);
  }
}

process.exit(allOk ? 0 : 1);
