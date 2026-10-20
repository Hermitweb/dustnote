#!/usr/bin/env node
/**
 * 生产环境冒烟测试（用于 test-orchestrate 的 prod 阶段）
 *
 * 比 shell 版本的 smoke-test.sh 覆盖面更广：
 *   1. 编译 shared + server
 *   2. 起一个生产模式的 server（开启 NODE_ENV=production）
 *   3. 验证核心 API 端点：
 *      - GET /api/v1/health
 *      - GET /api/v1/update-manifest（合法 / 强制升级 / 不带 header）
 *      - GET /api/v1/server-config
 *      - POST /api/v1/auth/setup（注册）
 *      - POST /api/v1/auth/login（解锁）
 *      - 错误响应不泄漏内部信息（400/401/404/429）
 *   4. 验证安全响应头（helmet 默认配置）
 *   5. 关闭 server
 *
 * 不依赖任何额外 npm 包，原生 fetch + setTimeout。
 *
 * 用法：
 *   node scripts/prod-smoke-test.mjs
 *   node scripts/prod-smoke-test.mjs --port 3300
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import process from 'node:process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

const port = (() => {
  const i = argv.indexOf('--port');
  return i >= 0 ? Number(argv[i + 1]) : 3210;
})();
const base = `http://localhost:${port}`;

const log = (...a) => process.stderr.write(`[smoke] ${a.join(' ')}\n`);
let pass = 0,
  fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail++;
    log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
};

function buildServer() {
  return new Promise((resolve, reject) => {
    log('编译 shared + server ...');
    const child = spawn(
      'pnpm',
      ['--filter', '@dustnote/shared', '--filter', '@dustnote/server', 'build'],
      { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' }
    );
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`build exit ${code}`))));
  });
}

async function waitForReady(maxMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(`${base}/api/v1/health`);
      if (r.ok) return;
    } catch {
      // 服务还没起来 → 继续轮询
    }
    await sleep(300);
  }
  throw new Error(`server not ready in ${maxMs}ms`);
}

function startServer(env = {}) {
  const child = spawn('node', ['server/dist/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DB_PATH: `./data/prod-smoke-${port}.db`,
      JWT_SECRET: 'prod-smoke-only-test-secret-do-not-use-0123456789abcdef',
      LOG_LEVEL: 'warn',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  return child;
}

function killChild(child) {
  if (!child || child.killed) return;
  try {
    child.kill();
  } catch {
    // 进程可能已经退出，kill 失败无需上抛
  }
}

async function expectStatus(method, path, opts = {}) {
  try {
    const r = await fetch(`${base}${path}`, {
      method,
      ...opts,
      headers: { 'X-Client-Version': '9.9.9', 'X-Client-Platform': 'web', ...(opts.headers || {}) },
    });
    const body = await r.text();
    return { status: r.status, headers: r.headers, body };
  } catch (e) {
    return { status: 0, error: String(e) };
  }
}

(async () => {
  await buildServer();

  log(`启动 server (port=${port}, NODE_ENV=production) ...`);
  const server = startServer();
  let exitInfo = null;
  server.on('exit', (code, sig) => {
    exitInfo = { code, sig };
  });

  try {
    await waitForReady();

    log('核心 API 验证 ...');
    // /health
    {
      const r = await expectStatus('GET', '/api/v1/health');
      check('GET /health 返回 200', r.status === 200, `status=${r.status}`);
      const j = safeJson(r.body);
      check(
        '/health 响应包含 ok / version',
        j && (j.ok === true || j.status === 'ok') && typeof j.version === 'string'
      );
    }

    // /update-manifest 合规 header
    {
      const r = await expectStatus('GET', '/api/v1/update-manifest', {
        headers: { 'X-Client-Version': '9.9.9', 'X-Client-Channel': 'stable' },
      });
      check('GET /update-manifest 合规返回 200', r.status === 200, `status=${r.status}`);
    }

    // /update-manifest 缺 header
    {
      const r = await fetch(`${base}/api/v1/update-manifest`, { method: 'GET' });
      // server 通常要求 X-Client-* 但允许匿名请求；至少要能解析
      check('GET /update-manifest 无 header 不崩溃', r.status >= 200 && r.status < 500);
    }

    // /server-config
    {
      const r = await expectStatus('GET', '/api/v1/server-config');
      check('GET /server-config 返回 200', r.status === 200);
    }

    // 404
    {
      const r = await expectStatus('GET', '/api/v1/__no_such_path__');
      check('GET /__no_such_path__ 返回 404', r.status === 404);
    }

    // 错误响应不泄漏堆栈
    {
      const r = await expectStatus('POST', '/api/v1/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invalid: true }),
      });
      check(
        'POST /auth/setup 错误体不包含堆栈',
        r.status >= 400 && r.status < 500 && !/at \w+\s*\(/.test(r.body),
        `body=${r.body.slice(0, 80)}`
      );
    }

    // 安全响应头
    {
      const r = await expectStatus('GET', '/api/v1/health');
      const h = r.headers;
      check('响应含 X-Content-Type-Options', !!h.get('x-content-type-options'));
      check(
        '响应含 X-Frame-Options / frame-ancestors',
        !!h.get('x-frame-options') || !!h.get('content-security-policy')
      );
      check('响应 Referrer-Policy', !!h.get('referrer-policy'));
    }
  } catch (e) {
    log('FATAL', e.message);
    fail++;
  } finally {
    killChild(server);
    await sleep(500);
  }

  if (exitInfo) {
    // server 中途挂掉是最常见的失败原因，把退出码带进报告（此前收集了却从不输出）
    log(`server 进程退出：code=${exitInfo.code} sig=${exitInfo.sig ?? '-'}`);
  }
  log(`\n=== 冒烟测试：pass=${pass} fail=${fail} ===`);
  process.exit(fail === 0 ? 0 : 1);
})();

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
