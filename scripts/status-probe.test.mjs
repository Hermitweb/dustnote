/**
 * 状态探针自身的测试（跑法：pnpm test:monitoring）
 *
 * 为什么必须有：探针是"外部可核实的线上事实"的唯一来源。它一旦坏掉是**静默的**——
 * 现实就发生过：红绿判定引用了一个从未填充的数组，`[].every()` 恒为 true，
 * 于是无论线上怎样都报绿、都 exit 0，nightly 告警形同虚设。
 * 这类"守卫自己失效"只能靠假服务器回归。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plaintextTargets, plaintextVerdict, plaintextUnreachable } from './plaintext-targets.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROBE = join(ROOT, 'scripts/status-probe.mjs');

/**
 * 关掉假服务器必须连**已建立的连接**一起关。
 * `server.close()` 只停止监听，不断开 keep-alive 连接——
 * 探针的 fetch 正是带 keep-alive 来的，于是测试跑完后事件循环仍被句柄吊住，
 * `node --test` 打印完结果却永远不退出（CI 会挂到超时）。
 */
function stopServer(srv) {
  srv.closeAllConnections?.();
  srv.unref?.();
  return new Promise((resolve) => srv.close(() => resolve()));
}

/** 与 deploy/nginx.conf 里那份策略同形；测试用它验证探针的 CSP 断言 */
// 显式 + 连接：相邻字符串字面量在 JS 里不会自动拼接（那是 C/Python 的习惯），
// ASI 会把它们变成三条独立语句——于是 CSP_OK 只剩第一段，测试就在'应判绿'处红掉。
const CSP_OK =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';" +
  " img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';" +
  " object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

function startServer(healthVersion, opts = {}) {
  const { omitCsp = false } = opts;
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url.includes('/health')) {
        return res.end(JSON.stringify({ ok: true, db: 'ok', version: healthVersion }));
      }
      if (req.url.includes('/update-manifest')) {
        return res.end(JSON.stringify({ latest: { version: '2.99.0' } }));
      }
      if (req.url.includes('/share/public')) {
        res.statusCode = 404;
        return res.end('{}');
      }
      res.setHeader('content-type', 'text/html');
      if (!omitCsp) res.setHeader('content-security-policy', CSP_OK);
      res.end('<html>ok</html>');
    });
    srv.listen(0, () => resolve(srv));
  });
}

/**
 * "明文已收口"的桩：对任何请求回 301，全测试文件共用一个。
 *
 * 为什么需要：探针的明文目标默认由 URL_BASE 推导（80 与 8080），而假服务器只有一个随机
 * 端口——不指桩就永远造不出"全绿"前提（同一端口无法既给 /api/v1/health 回 200、又给明文
 * 回 301）。R1 之后线上的正确形态本来就是 301/不可达，所以桩代表常态，特例才显式覆盖。
 */
let hardSrv = null;
async function hardenedPlaintextUrls() {
  if (!hardSrv) {
    hardSrv = await new Promise((resolve) => {
      const s = http.createServer((req, res) => {
        res.statusCode = 301;
        // Location 用常量：把 req.url 拼进去等于"目标由请求自己决定"，CodeQL 判
        // js/server-side-unvalidated-url-redirection（告警 #29）。测试只关心 301 这个
        // 收口形态，不关心跳去哪，所以这里不需要那个拼接。
        res.setHeader('location', 'https://hardened.invalid/moved');
        res.end('moved');
      });
      s.listen(0, () => resolve(s));
    });
  }
  const p = hardSrv.address().port;
  return `80=http://127.0.0.1:${p},8080=http://127.0.0.1:${p}`;
}

after(async () => {
  if (hardSrv) await stopServer(hardSrv);
  hardSrv = null;
});

/**
 * 本文件所有用例共用的**假版本号**：与仓库真实版本解耦（api.test 的 2.99.0 先例）。
 * 写死具体版本号的测试会在每次 bump 时自己变红——那不是门禁在工作，
 * 是夹具在跟仓库版本较劲。三处消费点（EXPECT_VERSION / startServer / 断言）
 * 现在都从这里取，杜绝"改了夹具忘了改断言"这种自相矛盾。
 */
const FIXTURE_VERSION = '2.99.0';

async function runProbe(port, args = [], extraEnv = {}) {
  const plaintextUrls = await hardenedPlaintextUrls();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [PROBE, ...args], {
      env: {
        ...process.env,
        STATUS_PROBE_URL: `http://127.0.0.1:${port}`,
        EXPECT_VERSION: FIXTURE_VERSION,
        STATUS_PROBE_PLAINTEXT_URLS: plaintextUrls,
        ...extraEnv,
      },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    /* 看门狗：探针若不自己退出，测试必须失败，而不是把整个门禁挂死 */
    const wd = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: 'TIMEOUT', out, err: err + ' [watchdog] 探针未在 40s 内退出' });
    }, 40_000);
    wd.unref?.();
    child.on('exit', (code) => {
      clearTimeout(wd);
      resolve({ code, out, err });
    });
  });
}

test('版本一致 → exit 0 且报告 ok:true', async () => {
  const srv = await startServer(FIXTURE_VERSION);
  try {
    const r = await runProbe(srv.address().port);
    assert.equal(r.code, 0, `应判绿，实际 stderr=${r.err.slice(0, 200)}`);
    assert.equal(JSON.parse(r.out).ok, true);
  } finally {
    await stopServer(srv);
  }
});

test('线上版本落后 → exit 1（nightly 靠它开 issue，永绿等于没有告警）', async () => {
  const srv = await startServer('2.5.40');
  try {
    const r = await runProbe(srv.address().port);
    assert.equal(r.code, 1);
    const rep = JSON.parse(r.out);
    assert.equal(rep.ok, false);
    assert.ok(rep.results.some((x) => x.name === 'health' && !x.ok));
  } finally {
    await stopServer(srv);
  }
});

test('明文仍可服务 → 该项判不过、整体判红（R1 已收口，不再是 informational）', async () => {
  // 假服务器对明文回 200 = 明文仍在服务。收口做到位之后，这种现状必须能被抓出来：
  // 比如有人把 PORT_BIND 改回 0.0.0.0、或前置 301 被删，nightly 要当场红，而不是继续打ℹ️。
  const srv = await startServer(FIXTURE_VERSION);
  try {
    const r = await runProbe(srv.address().port, [], {
      // 显式让明文指向这台 200 的假服务器（默认桩是 301，代表已收口的常态）
      STATUS_PROBE_PLAINTEXT_URLS: `80=http://127.0.0.1:${srv.address().port}`,
    });
    const rep = JSON.parse(r.out);
    const row = rep.results.find((x) => x.name === 'http-plaintext:80');
    assert.ok(row, '应有明文探测项');
    assert.equal(row.ok, false, '明文回 200 必须判不过：' + row.note);
    assert.match(row.note, /R1 HTTPS 收口已漏/);
    assert.equal(row.informational, undefined, '明文项已升为硬断言，不该再带 informational');
    assert.equal(rep.ok, false);
    assert.notEqual(r.code, 0, '明文未收口时探针必须非零退出（nightly 靠它开 issue）');
  } finally {
    await stopServer(srv);
  }
});

test('恶意响应不能劫持生成区（标记数不变、不产生新标题）', async () => {
  const srv = await startServer('9.9.9<!-- status-probe:end -->\n## HIJACKED');
  const dir = mkdtempSync(join(ROOT, '.probe-test-'));
  const target = join(ROOT, 'docs/status.md');
  const backup = join(dir, 'status.md.bak');
  try {
    copyFileSync(target, backup);
    // --update 会真写文件：先跑一次确认拒绝非法版本、再校验落盘内容
    const r = await runProbe(srv.address().port, ['--update']);
    assert.equal(r.code, 1, '非法版本号应判为不达标');
    const md = readFileSync(target, 'utf8');
    assert.equal((md.match(/<!-- status-probe:start -->/g) || []).length, 1);
    assert.equal((md.match(/<!-- status-probe:end -->/g) || []).length, 1);
    assert.ok(!/^## HIJACKED/m.test(md), '注入内容不得成为页面标题');
    assert.ok(!/9\.9\.9<!--/.test(md), '注入的标记本身必须被抹掉');
    assert.ok(md.includes('未知'), '非法版本应显示为未知');
  } finally {
    if (existsSync(backup)) {
      copyFileSync(backup, target);
    }
    rmSync(dir, { recursive: true, force: true });
    await stopServer(srv);
  }
});

/**
 * 净化机制本身的可执行证据。
 *
 * 旧实现是黑名单（"抹掉生成区标记，其余字符放行"），这个 payload 能从它手里漏过去：
 * `<img src=… onerror=…>` 与 `[x](javascript:…)` 里没有 status-probe 标记，
 * 却被原样写进仓库里那份状态页——GitHub 会渲染表格单元格内的 img，
 * 于是被攻陷/被 MITM 的服务器拿到一个"仓库内容触发的对外请求"。
 * 白名单实现必须把它删干净，这条测试就是两者的分界线（改回黑名单即红）。
 */
test('网络回包的 HTML/链接载荷不得进入状态页表格', async () => {
  const payload = '<img src=x onerror=alert(1)> [x](javascript:1) &amp; <b>';
  const srv = await startServer(payload);
  const dir = mkdtempSync(join(ROOT, '.probe-test-'));
  const target = join(ROOT, 'docs/status.md');
  const backup = join(dir, 'status.md.bak');
  try {
    copyFileSync(target, backup);
    const r = await runProbe(srv.address().port, ['--update']);
    assert.equal(r.code, 1, '非法版本必须判失败');
    const md = readFileSync(target, 'utf8');
    const gen = md.split('<!-- status-probe:start -->')[1].split('<!-- status-probe:end -->')[0];
    const rows = gen.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| ---'));
    assert.ok(rows.length >= 4, `应生成探测行，实际 ${rows.length} 行`);
    for (const row of rows) {
      // 结构不变量：5 列的行有 6 个竖线 → split('|') 得 7 段（首尾为空串）。
      // 载荷里的 | 若漏进来，这一行就会被劈成多列（行数不变但列数变了）
      assert.equal(row.split('|').length, 7, `表格列数被破坏: ${row}`);
      for (const ch of ['<', '>', '&', '!', '[', ']']) {
        assert.ok(!row.includes(ch), `单元格不得含 ${ch}：${row}`);
      }
    }
    assert.ok(!/<[a-zA-Z/]/.test(gen), '不得出现 HTML 标签起始');
    assert.ok(!/\[[^\]]*\]\(/.test(gen), '不得出现可点击的 markdown 链接');
    assert.ok(gen.includes('未知'), '非法版本号应显示为未知');
  } finally {
    if (existsSync(backup)) copyFileSync(backup, target);
    rmSync(dir, { recursive: true, force: true });
    await stopServer(srv);
  }
});

/**
 * 边缘 CSP 必须实测，不能信配置文件「写过了」。
 *
 * nginx 的 add_header 不继承：子 location 只要自己声明过任何 add_header，父级的安全头
 * 就整个不再出现在该路径的响应上——deploy/nginx.conf 因此在三处各抄了同一份头。这种
 * 「抄三份」的结构，一次改动就可能漏一处，而漏掉的正好是页面。代码里看不见这个失败
 * （helmet 的 CSP 本来就是关的），只有拨测看得见。
 */
test('页面响应没有 CSP 头 → 判红（边缘安全头不能靠配置自证）', async () => {
  const srv = await startServer('2.99.0', { omitCsp: true });
  try {
    const r = await runProbe(srv.address().port);
    assert.equal(r.code, 1, '缺 CSP 必须整体判红');
    const rep = JSON.parse(r.out);
    const item = rep.results.find((x) => x.name === 'csp-page');
    assert.ok(item, '应有 csp-page 探测项');
    assert.equal(item.ok, false);
    assert.match(item.note, /Content-Security-Policy/);
  } finally {
    await stopServer(srv);
  }
});

test('CSP 在位但缺关键 directive → 判红，且只报缺哪一项', async () => {
  const weak = http.createServer((req, res) => {
    if (req.url.includes('/health')) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ ok: true, db: 'ok', version: '2.99.0' }));
    }
    res.setHeader('content-type', 'text/html');
    // 只给 default-src：script-src / object-src / frame-ancestors / base-uri 全缺
    res.setHeader('content-security-policy', "default-src 'self'");
    res.end('<html>ok</html>');
  });
  await new Promise((r) => weak.listen(0, r));
  try {
    const r = await runProbe(weak.address().port);
    assert.equal(r.code, 1);
    const item = JSON.parse(r.out).results.find((x) => x.name === 'csp-page');
    assert.equal(item.ok, false);
    assert.match(item.note, new RegExp('script-src .self.'));
    // 报告里不回填响应头原文（那是网络数据），只列缺失的 directive
    assert.ok(!item.note.includes('unsafe-inline'), 'note 不得回显响应头原文');
  } finally {
    weak.closeAllConnections?.();
    weak.unref?.();
    await new Promise((r) => weak.close(() => r()));
  }
});

// —— 明文收口：目标端口与判定（见 scripts/plaintext-targets.mjs 的由来注释）——
test('标准 https 域名要探两处：80 与绕过前置代理的 8080', () => {
  const t = plaintextTargets('https://napi.iniess.cn');
  assert.deepEqual(
    t.map((x) => x.label),
    ['80', '8080']
  );
  assert.equal(t[0].url, 'http://napi.iniess.cn');
  assert.equal(t[1].url, 'http://napi.iniess.cn:8080');
});

test('base 里已写明端口时不臆造 8080 旁路，只探那一个', () => {
  const t = plaintextTargets('http://127.0.0.1:4567');
  assert.equal(t.length, 1);
  assert.equal(t[0].label, '4567');
});

test('收口判定返回结构化结论：3xx 与 404 算收口，200/400/5xx 不算', () => {
  for (const s of [301, 302, 307, 308, 404]) {
    const v = plaintextVerdict(s);
    assert.equal(v.hardened, true, 'HTTP ' + s + ' 应判收口');
    assert.match(v.note, /^明文已收口/);
  }
  for (const s of [200, 204, 300, 400, 500]) {
    const v = plaintextVerdict(s);
    assert.equal(v.hardened, false, 'HTTP ' + s + ' 仍有明文服务');
    assert.match(v.note, /仍可服务/);
  }
  // 300 是多选，不是跳转到 https——不能算收口，否则一个错误的分类就能刷绿
  assert.match(plaintextVerdict(200).note, /R1 HTTPS 收口已漏/);
});

test('连接层失败算收口，但只有真失败才算（4xx/5xx 不许走这条路刷绿）', () => {
  const v = plaintextUnreachable('connect ECONNREFUSED 127.0.0.1:8080');
  assert.equal(v.hardened, true);
  assert.match(v.note, /未对外发布/);
  assert.match(v.note, /ECONNREFUSED/);
  // 端口在应答就必须走状态分类：400 不是"没在监听"
  assert.equal(plaintextVerdict(400).hardened, false);
});

test('明文端口真的没对外发布 → 该项判过，整体保持绿', async () => {
  // 借一个刚关掉的端口，拿到的就是 ECONNREFUSED（R1 之后 8080 收回环就是这个形态）
  const dead = await new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, () => resolve(s));
  });
  const deadPort = dead.address().port;
  await stopServer(dead);
  const srv = await startServer(FIXTURE_VERSION);
  try {
    const r = await runProbe(srv.address().port, [], {
      STATUS_PROBE_PLAINTEXT_URLS: `8080=http://127.0.0.1:${deadPort}`,
    });
    const rep = JSON.parse(r.out);
    const row = rep.results.find((x) => x.name === 'http-plaintext:8080');
    assert.ok(row, '应有明文探测项');
    assert.equal(row.ok, true, row.note);
    assert.equal(r.code, 0, '明文端口未发布时整体应判绿：' + r.err);
  } finally {
    await stopServer(srv);
  }
});

test('多目标覆盖：每个 label 各出一行，且都不带 informational', async () => {
  const srv = await startServer(FIXTURE_VERSION);
  try {
    const p = srv.address().port;
    const r = await runProbe(srv.address().port, [], {
      STATUS_PROBE_PLAINTEXT_URLS: `80=http://127.0.0.1:${p},8080=http://127.0.0.1:${p}`,
    });
    const rep = JSON.parse(r.out);
    const rows = rep.results.filter((x) => x.name.startsWith('http-plaintext'));
    assert.equal(
      rows.length,
      2,
      '两个 label 应各出一行，实际：' + rows.map((x) => x.name).join(',')
    );
    for (const row of rows) {
      assert.match(row.name, /^http-plaintext:\d+$/);
      assert.equal(row.informational, undefined, row.name + ' 已升为硬断言');
      assert.equal(row.ok, false, '明文 200 应判不过');
    }
    assert.equal(r.code, 1, '两项都不过 → 退出码 1');
  } finally {
    await stopServer(srv);
  }
});
/**
 * 生成区标记丢了必须判红。
 *
 * 这是 2026-09-30 盘点抓到的真实失效形态的**另一半**：当时探针确实在跑、也确实成功，
 * 但没有任何人把结果写回 docs/status.md，于是页面自称「下一次拨测会覆盖」而实际四天没动。
 * 如果标记被手抖删掉，旧实现会静默不命中——replace 没匹配上、探针照样 exit 0、
 * 状态页继续显示旧数据。这条测试把「静默」变成「exit 1」。
 */
test('标记丢失时 --update 必须 exit 1，且不许改动文件', async () => {
  const srv = await startServer(FIXTURE_VERSION);
  const dir = mkdtempSync(join(ROOT, '.probe-test-'));
  const target = join(ROOT, 'docs/status.md');
  const backup = join(dir, 'status.md.bak');
  try {
    copyFileSync(target, backup);
    const original = readFileSync(target, 'utf8');
    // 造一个「标记没了」的页面
    writeFileSync(
      target,
      original.replace(
        /<!-- status-probe:start -->[\s\S]*?<!-- status-probe:end -->/g,
        '（标记被误删）'
      )
    );
    assert.ok(
      !readFileSync(target, 'utf8').includes('status-probe:start'),
      '构造的坏页面要真的没有标记'
    );
    const r = await runProbe(srv.address().port, ['--update']);
    assert.equal(r.code, 1, '标记丢失必须判失败，不能 exit 0 假装更新过');
    assert.match(r.err, /缺少生成区标记/);
    const after = readFileSync(target, 'utf8');
    assert.ok(after.includes('（标记被误删）'), '失败时不该写任何东西进去');
    assert.equal(after, readFileSync(target, 'utf8'));
  } finally {
    if (existsSync(backup)) copyFileSync(backup, target);
    rmSync(dir, { recursive: true, force: true });
    await stopServer(srv);
  }
});

/**
 * 探针全绿时 --update 要真的落盘——否则 publish job 会拿到一份没变的文件，
 * 而「无变化」和「没写进去」在 git diff 眼里长得一样。
 */
test('拨测全绿时 --update 会把生成区写成绿，并报告已更新', async () => {
  const srv = await startServer(FIXTURE_VERSION);
  const dir = mkdtempSync(join(ROOT, '.probe-test-'));
  const target = join(ROOT, 'docs/status.md');
  const backup = join(dir, 'status.md.bak');
  try {
    copyFileSync(target, backup);
    // 先把生成区改成明显不同的内容，确保「写入了」可被观察到
    const cur = readFileSync(target, 'utf8');
    writeFileSync(
      target,
      cur.replace(
        /(<!-- status-probe:start -->)[\s\S]*?(<!-- status-probe:end -->)/,
        '$1' + String.fromCharCode(10) + 'SENTINEL' + String.fromCharCode(10) + '$2'
      )
    );
    const r = await runProbe(srv.address().port, ['--update']);
    assert.equal(r.code, 0, '期望版本一致时应判绿：' + r.err);
    const md = readFileSync(target, 'utf8');
    assert.ok(!md.includes('SENTINEL'), '哨兵内容必须被真实结果覆盖');
    assert.match(md, /当前状态：🟢 正常/);
    (assert.match(md, new RegExp('v' + FIXTURE_VERSION.replace(/\./g, '\\.'))),
      assert.match(r.err, /已按拨测结果更新/));
  } finally {
    if (existsSync(backup)) copyFileSync(backup, target);
    rmSync(dir, { recursive: true, force: true });
    await stopServer(srv);
  }
});
