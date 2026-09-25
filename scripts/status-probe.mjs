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
    return null;
  })
);

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
    ok: true,
    ms: 0,
    status: res.status,
    note: hardened ? '明文已收口' : `明文仍可服务（status=${res.status}，R1 HTTPS 收口待办）`,
  });
} catch (err) {
  results.push({
    name: 'http-plaintext(informational)',
    ok: true,
    ms: 0,
    note: `明文不可达：${String(err?.message ?? err)}`,
  });
}

const allOk = results.every((r) => r.ok);
const report = { at: new Date().toISOString(), url: URL_BASE, expected, ok: allOk, results };
console.log(JSON.stringify(report, null, 2));

if (UPDATE) {
  const statusPath = join(ROOT, 'docs/status.md');
  let md = readFileSync(statusPath, 'utf8');
  const stamp = report.at.slice(0, 16).replace('T', ' ');
  const headLine =
    `> 最近拨测：${stamp} UTC · ${allOk ? '🟢 全部通过' : '🔴 有失败项'} · 期望版本 v${expected}` +
    '（探针 `node scripts/status-probe.mjs`，CI 每 6h 运行。本页状态由拨测结果驱动，不再由发版动作刷绿）';
  md = md.replace(/^> 最近(人工核对|拨测)：.*$/m, headLine);
  const banner = allOk
    ? '🟢 **所有系统正常运行**'
    : '🔴 **拨测发现异常**（运行 `node scripts/status-probe.mjs` 复现明细）';
  md = md.replace(/^[🟢🔴] \*\*(所有系统正常运行|拨测发现异常)\*\*.*$/m, banner);
  writeFileSync(statusPath, md);
  console.error(`docs/status.md 已按拨测结果更新（${allOk ? '绿' : '红'}）`);
}

process.exit(allOk ? 0 : 1);
