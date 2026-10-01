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
import { plaintextTargets, plaintextVerdict } from './plaintext-targets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_BASE = (process.env.STATUS_PROBE_URL || 'https://napi.iniess.cn').replace(/\/+$/, '');
const UPDATE = process.argv.includes('--update');
const TIMEOUT_MS = 15_000;
const MARK_START = '<!-- status-probe:start -->';
const MARK_END = '<!-- status-probe:end -->';

const rawExpected =
  process.env.EXPECT_VERSION ||
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

/**
 * 版本号必须是 x.y.z —— 它既进请求头，也会被写进 docs/status.md。
 *
 * 净化刻意写成「用捕获组重建字符串」，而不是「正则通过了就沿用原串」：
 * 下游拿到的是三段数字重新拼出来的值，结构上不可能夹带原输入里的标记、换行或
 * HTML 字符。污点分析把 `.test()` 这类布尔判断当作"依赖推理的守卫"、不当作净化，
 * 重建后的串才是它认的形式。
 */
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
function safeVersion(v) {
  const m = SEMVER_RE.exec(String(v ?? ''));
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}
const expected = safeVersion(rawExpected);
if (expected === null) {
  console.error(
    `期望版本号不合法（需要 x.y.z）: ${JSON.stringify(String(rawExpected).slice(0, 40))}`
  );
  // 这里还没有任何网络句柄，直接退出是安全的（文件末尾那条 exitCode 注释针对的是
  // fetch 之后强杀会踩 libuv 断言的场景）
  process.exit(1);
}

/**
 * 任何要写进 markdown 的东西先净化。
 *
 * 表格里的 note / version 来自**网络响应**：服务器被攻陷或被中间人改写时，
 * 一个 `<!-- status-probe:end -->` 就能把生成区提前关掉，
 * 从此往仓库里那份状态页注入任意 markdown。
 *
 * 原先是黑名单写法——"先抹掉生成区标记，再放其它字符过去"，少列一个变体
 * （大小写、编码、空白差异）就漏。现在改成白名单：只留字母数字、空白和已知
 * 无害标点（含中日韩标点）。`<` `>` `&` `!` `[` `]` 这些能拼出 HTML 注释/标签/
 * 链接的字符从一开始就进不来，所以标记无法成形，不必再单独抹一遍。
 */
const DISALLOWED_RE =
  /[^A-Za-z0-9 ,.:;?+=_/()'"\u4e00-\u9fff\u3000-\u303f\uff01-\uff5e\u00b7\u2013\u2014\u2018\u2019\u201c\u201d\u2192\u2260-]/g;

function safeText(v, max = 160) {
  return String(v ?? '')
    .replace(/\|/g, '/') // 表格分隔符换斜杠：留着它会把一行劈成多列
    .replace(/\s+/g, ' ') // 换行/制表先并成空格：一行就是一条表格行
    .replace(DISALLOWED_RE, '')
    .slice(0, max);
}

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
/**
 * 红绿判定只看"硬探测项"：informational（明文收口这类已知现状）不参与，
 * 否则会制造告警疲劳。注意必须在结尾**求值时**再过滤——
 * results 是逐条 push 的，提前快照会得到空数组，
 * 而 `[].every()` 恒为 true：这个 bug 曾让探针无论什么都报绿、exit 0，
 * nightly 告警因此形同虚设（由恶意假服务器回归测试暴露）。
 */
const isHard = (r) => !r.informational;

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

// 3.4) 页面响应必须真的带着 CSP。
//
//   为什么要单独测它：express 侧的 helmet 是 contentSecurityPolicy:false，光看代码
//   会以为「这站没 CSP」；实际上页面从不由 express 发出——nginx 直接 root /app/web-dist
//   静态吐出（见 deploy/nginx.conf），策略也在 nginx 上。既然防线在那里，就该由
//   拨测去验证**那条响应头本身**，而不是相信配置文件写过了。
//
//   nginx 的 add_header 不继承：子 location 只要自己写过任何 add_header，父级的
//   安全头就整个不再出现（该坑已在 nginx.conf 里留了注释）。所以「CSP 在不在」是
//   每个 location 各自的事，一次配置改动就能悄悄让页面裸奔——这条断言就是那张网。
const CSP_REQUIRED = [
  [/default-src[^;]*'self'/, "default-src 'self'"],
  [/script-src[^;]*'self'/, "script-src 'self'"],
  [/object-src[^;]*'none'/, "object-src 'none'"],
  [/frame-ancestors[^;]*'none'/, "frame-ancestors 'none'"],
  [/base-uri[^;]*'self'/, "base-uri 'self'"],
];
results.push(
  await probe('csp-page', '/', (res) => {
    if (!res.ok) return `HTTP ${res.status}`;
    // 注意：这里不把响应头原文写进 note（那是网络数据），只报缺哪一项
    const csp = res.headers.get('content-security-policy');
    if (!csp) return '页面响应没有 Content-Security-Policy 头';
    const missing = CSP_REQUIRED.filter(([re]) => !re.test(csp)).map(([, label]) => label);
    return missing.length ? `CSP 缺少: ${missing.join(' ')}` : null;
  })
);

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
//    R1「强制 HTTPS」落地前明文可达是已知现状，红它 = 制造告警疲劳。
//
//    必须逐个端口探，不能只探 80：容器把 8080 直接发布到公网，那条路**绕过前置代理**，
//    由容器内 nginx 自己回页面。只验 80 会得出假绿——80 上 301 了，明文却还在 8080 上
//    正常服务（2026-09-30 实测 napi.iniess.cn 的 80 与 8080 都是 200，无一处跳转）。
for (const t of plaintextTargets(URL_BASE)) {
  try {
    const res = await fetch(t.url + '/api/v1/health', {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    results.push({
      name: 'http-plaintext:' + t.label + '(informational)',
      informational: true,
      ok: true,
      ms: 0,
      status: res.status,
      note: plaintextVerdict(res.status),
    });
  } catch (err) {
    results.push({
      name: 'http-plaintext:' + t.label + '(informational)',
      informational: true,
      ok: true,
      ms: 0,
      note: '明文不可达：`String(err?.message ?? err).slice(0, 60)`',
    });
  }
}

const allOk = results.filter(isHard).every((r) => r.ok);
const liveVersion = safeVersion(results.find((r) => r.name === 'health')?.version);
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
      const note = safeText(r.note, 200);
      const name = safeText(r.name, 60);
      const ms = Number.isFinite(r.ms) ? Math.max(0, Math.round(r.ms)) : 0;
      const st = Number.isFinite(r.status) ? r.status : '-';
      return `| ${name} | ${flag} | ${ms}ms | ${st} | ${note} |`;
    })
    .join('\n');
  const liveLabel = liveVersion ? `v${liveVersion}` : '未知（响应未给合法版本号）';
  const generated = [
    MARK_START,
    '',
    `> 最近拨测：${stamp} UTC · ${allOk ? '🟢 全部通过' : '🔴 有失败项'} · 期望版本 v${expected}`,
    '',
    allOk
      ? `**当前状态：🟢 正常** — 线上 **${liveLabel}**（探针判定，非人工声明）`
      : `**当前状态：🔴 异常** — 线上 **${liveLabel}**，期望 v${expected}（明细见下表；复现：\`node scripts/status-probe.mjs\`）`,
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
  // 判据必须是「标记在不在」，不是「内容变没变」：内容没变是正常情形（线上状态未动），
  // 而标记丢了才是真故障——那时 replace 静默不命中、探针照样 exit 0，
  // 状态页就会永远停在旧数据上而没人知道。这正是 2026-09-30 盘点抓到的那类失效。
  const marked = md.includes(MARK_START) && md.includes(MARK_END);
  if (!marked) {
    console.error('::error::docs/status.md 缺少生成区标记，--update 无法落笔');
    process.exitCode = 1;
  } else if (next === md) {
    console.error('docs/status.md 生成区无变化（线上状态未动）');
  } else {
    writeFileSync(statusPath, next);
    console.error('docs/status.md 已按拨测结果更新（' + (allOk ? '绿' : '红') + '）');
  }
}

/*
 * 用 exitCode 而不是 process.exit()：后者会在句柄（undici 的 keep-alive socket）
 * 还没关闭时强杀进程，Windows 上直接触发 libuv 断言
 * （Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)，退出码 0xC0000409），
 * 于是"探针判定"在最需要它自检的开发机上反而是坏的。
 */
/*
 * 退出码取「已置的失败」与「本次判定」的较大者：--update 那条「标记丢失」已经先把
 * exitCode 置成 1，而 `allOk` 仍是 true——直接赋值会把失败抹平。
 * 新加的标记测试正是这样抓到它的（写完测试才发现实现里藏着这个覆盖）。
 */
process.exitCode = Math.max(process.exitCode || 0, allOk ? 0 : 1);
