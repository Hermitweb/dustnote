/**
 * 状态探针自身的测试（跑法：pnpm test:monitoring）
 *
 * 为什么必须有：探针是"外部可核实的线上事实"的唯一来源。它一旦坏掉是**静默的**——
 * 现实就发生过：红绿判定引用了一个从未填充的数组，`[].every()` 恒为 true，
 * 于是无论线上怎样都报绿、都 exit 0，nightly 告警形同虚设。
 * 这类"守卫自己失效"只能靠假服务器回归。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function startServer(healthVersion) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url.includes('/health')) {
        return res.end(JSON.stringify({ ok: true, db: 'ok', version: healthVersion }));
      }
      if (req.url.includes('/update-manifest')) {
        return res.end(JSON.stringify({ latest: { version: '2.5.46' } }));
      }
      if (req.url.includes('/share/public')) {
        res.statusCode = 404;
        return res.end('{}');
      }
      res.setHeader('content-type', 'text/html');
      res.end('<html>ok</html>');
    });
    srv.listen(0, () => resolve(srv));
  });
}

function runProbe(port, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [PROBE, ...args], {
      env: {
        ...process.env,
        STATUS_PROBE_URL: `http://127.0.0.1:${port}`,
        EXPECT_VERSION: '2.5.46',
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
  const srv = await startServer('2.5.46');
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

test('明文收口项是 informational：它失败不牵连总红', async () => {
  // 假服务器没有 https→http 的重定向语义，该项必然记为"明文仍可服务"，
  // 但它不该让整体变红（否则 R1 落地前 nightly 天天误报）
  const srv = await startServer('2.5.46');
  try {
    const r = await runProbe(srv.address().port);
    const rep = JSON.parse(r.out);
    const info = rep.results.find((x) => x.name.startsWith('http-plaintext'));
    assert.ok(info, '应有明文探测项');
    assert.equal(r.code, 0, '明文项存在时整体仍应绿');
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
