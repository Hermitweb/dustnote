#!/usr/bin/env node
/**
 * 从服务端代码生成 docs/api.md（端点清单）。
 *
 * 为什么生成而不手写：一份**看起来完整**的手写 API 文档比没有更坏——人会照它写客户端，
 * 而它必然与路由漂移。这里只声明能从代码机械读出的事实：方法、完整路径、是否需要
 * access token（依据 app.ts 里 authMiddleware 的挂载位置 + 它自己的公开路径表）。
 * 响应结构交给 openapi.yaml 与路由内的 zod schema，不在此杜撰。
 *
 * 解析函数都收一个 read 参数（而不是直接读盘），为的是能被测试喂假文件系统：
 * 一条门禁如果自己算错了，它同时制造噪音与漏报。
 *
 * 用法：node scripts/gen-api-inventory.mjs [--check]
 *   默认写盘；--check 只比对，不一致 exit 1（CI 用它拦漂移）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/api.md');
const realRead = (p) => readFileSync(join(ROOT, p), 'utf8');

/**
 * 从 app.ts 读出：挂载顺序（含行号）、authMiddleware 所在行、路由符号 → 源文件。
 * 映射关系一律从 import 语句解析，绝不硬编码文件名——上一版写了张手工映射表，
 * 结果猜出一个不存在的路径直接 ENOENT。
 */
export function parseApp(read) {
  const src = read('server/src/app.ts');
  const lines = src.split(/\r?\n/);
  const mounts = [];
  let authAt = -1;
  const files = {};
  const importRe = /import\s*\{([^}]+)\}\s*from\s*'\.\/routes\/([\w-]+)\.js'/g;
  for (const mm of src.matchAll(importRe)) {
    for (const sym of mm[1].split(',')) {
      const name = sym.trim();
      if (name.endsWith('Router')) files[name] = 'server/src/routes/' + mm[2] + '.ts';
    }
  }
  lines.forEach((l, i) => {
    if (authAt < 0 && /app\.use\('\/api\/v1',\s*authMiddleware\)/.test(l)) authAt = i;
    const g = /app\.use\('\/api\/v1',\s*(\w+)\)/.exec(l);
    if (g && g[1].endsWith('Router')) mounts.push({ at: i, symbol: g[1] });
    // 数组式挂载：app.use(['/api/v1/a', '/api/v1/b'], router)
    if (/app\.use\(\s*\[/.test(l)) {
      for (let j = i; j < Math.min(i + 12, lines.length); j++) {
        const g2 = /(\w+Router)\)/.exec(lines[j]);
        if (g2) {
          mounts.push({ at: j, symbol: g2[1] });
          break;
        }
      }
    }
  });
  return { mounts, authAt, files };
}

/** authMiddleware 自己的公开路径表：精确匹配 + 前缀匹配。 */
export function parsePublic(read) {
  const src = read('server/src/middleware/auth.ts');
  const exact = new Set(Array.from(src.matchAll(/p === '([^']+)'/g), (m) => m[1]));
  const prefix = new Set(Array.from(src.matchAll(/startsWith\('([^']+)'\)/g), (m) => m[1]));
  return { exact, prefix };
}

/** 一个路由文件里的 (方法, 路径)。 */
export function parseRoutes(read, file) {
  const out = [];
  const re = /(\w*[Rr]outer|router)\.(get|post|patch|put|delete)\('([^']+)'/;
  read(file)
    .split(/\r?\n/)
    .forEach((l, i) => {
      const m = re.exec(l);
      if (m) out.push({ method: m[2].toUpperCase(), path: m[3], line: i + 1 });
    });
  return out;
}

/** 把三份源码合成清单。返回 { rows, unresolved, pubCount }。 */
export function buildInventory(read) {
  const { mounts, authAt, files } = parseApp(read);
  const pub = parsePublic(read);
  const rows = [];
  const seen = new Set();
  const unresolved = [];
  for (const mount of mounts) {
    const file = files[mount.symbol];
    if (!file) {
      // 解析不到就报出来：静默跳过等于清单少一截而没人发现。
      unresolved.push(mount.symbol);
      continue;
    }
    const afterAuth = authAt >= 0 && mount.at > authAt;
    for (const r of parseRoutes(read, file)) {
      const rel = r.path.startsWith('/') ? r.path : '/' + r.path;
      const full = '/api/v1' + rel;
      const isPublicPath = pub.exact.has(rel) || [...pub.prefix].some((p) => rel.startsWith(p));
      const key = mount.symbol + '|' + full + '|' + r.method;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        method: r.method,
        path: full,
        auth: afterAuth && !isPublicPath ? '需要' : '公开',
        router: mount.symbol,
      });
    }
  }
  rows.sort((a, b) => (a.router + a.path + a.method).localeCompare(b.router + b.path + b.method));
  return { rows, unresolved, pubCount: rows.filter((r) => r.auth === '公开').length };
}

/**
 * openapi.yaml 的 path 分组数，以及上表里被它覆盖的条数。
 *
 * 带一个自我怀疑的出口：文件里明明写了 paths: 却一条都没解析出来，一定是
 * 缩进或引号形式变了（这条正则的写法很挑），此时 groups=0 会让文档说成
 * 「覆盖 0 条」——看起来像个结论，其实是解析器瞎了。所以标出来让 main 拦。
 */
export function specCoverage(read, rows) {
  const norm = (p) => p.replace(/:[A-Za-z0-9_]+/g, '{id}').replace(/\{[^}]+\}/g, '{id}');
  const specSrc = read('docs/openapi.yaml');
  const specPaths = new Set(
    specSrc
      .split(/\r?\n/)
      .map((l) => /^ {2}['"]?(\/[^:'"]+)['"]?:/.exec(l)?.[1])
      .filter(Boolean)
  );
  return {
    groups: specPaths.size,
    covered: rows.filter((r) => specPaths.has(norm(r.path.slice(7)))).length,
    declared: /^paths:\s*$/m.test(specSrc),
  };
}

/** 渲染整页 markdown。纯函数：喂 rows 与覆盖数即可，测试用它断言措辞与事实一致。 */
export function render(rows, pubCount, spec) {
  const table = rows
    .map((r) => '| ' + r.method + ' | `' + r.path + '` | ' + r.auth + ' | ' + r.router + ' |')
    .join('\n');
  const summary =
    '共 **' +
    rows.length +
    '** 条路由：公开 ' +
    pubCount +
    ' 条、需 access token ' +
    (rows.length - pubCount) +
    ' 条。认证=公开 指不要求 access token，但仍受客户端头校验与限流约束。';
  const specNote =
    '关于 docs/openapi.yaml：它当前描述 ' +
    spec.groups +
    ' 个 path 分组，与上表 ' +
    rows.length +
    ' 条中的 ' +
    spec.covered +
    ' 条对得上。' +
    '未覆盖部分是**已知缺口**：补齐要逐个核对真实响应体，凑数只会得到一份看起来完整的假文档。';
  return [
    '# API 一览',
    '',
    '> 本页由 `pnpm api:gen` 从 server/src 生成，请勿手改；CI 里 `pnpm api:check` 做漂移检测。',
    '> 它只列**能从代码机械读出**的事实：方法、路径、是否需要 token。请求/响应的字段定义在',
    '> server/src/routes/*.ts 的 zod schema 与 docs/openapi.yaml 里——那两份才是结构的可信来源，',
    '> 这里不复述，免得两份说法互相打脸。',
    '',
    '## 调用约定',
    '',
    '- 业务端点统一前缀 `/api/v1`；`/metrics` 是唯一挂在根上的非业务端点。',
    '- 认证：`Authorization: Bearer <access token>`。`/api/v1/auth/refresh` 另接受 `X-Refresh-Token` 头，给存不了 cookie 的客户端（RN）用。',
    '- 客户端标识：除下表标为「公开」的端点外，`/api/v1/*` 要求 `X-Client-Version`、`X-Client-Platform`、`X-Client-Channel`、`X-Client-Device-Id` 四个头，缺失返回 400 `missing_client_headers`。',
    '- 正文语义：笔记内容以客户端加密后的密文信封传输，服务端不持有明文。',
    '- 限流：写操作按用户 300 次/分钟；公开分享与解锁端点按 IP 单独更严；命中返回 429 并带 `Retry-After`。',
    '',
    '- `GET /api/v1/update-manifest` 返回各端最新与最低支持版本；版本过低或被强制升级返回 410。',
    '',
    '## 端点清单',
    '',
    summary,
    '',
    '| 方法 | 路径 | 认证 | 所属路由 |',
    '| --- | --- | --- | --- |',
    table,
    '',
    specNote,
    '',
    '## 错误响应',
    '',
    '> 形如 { error: <机器码>, ... }。常见机器码：missing_client_headers、invalid_client_version、',
    '> too_many_requests、too_many_writes、invalid_cursor、invalid_since、unauthorized、not_found、',
    '> share_locked。完整集合以路由里的字符串常量为准——同样是为了不在文档里另立一套说法。',
    '',
  ].join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const { rows, unresolved, pubCount } = buildInventory(realRead);
  for (const f of Object.values(parseApp(realRead).files))
    if (!existsSync(join(ROOT, f))) unresolved.push(f);
  if (unresolved.length) {
    console.error('[FAIL] 已挂载但解析不到源文件的路由：' + unresolved.join(', '));
    process.exitCode = 1;
    return;
  }
  if (!rows.length) {
    console.error('[FAIL] 一条路由都没解析到——多半是 app.ts 的挂载写法变了，不是真没有路由');
    process.exitCode = 1;
    return;
  }
  const spec = specCoverage(realRead, rows);
  if (spec.declared && spec.groups === 0) {
    console.error(
      '[FAIL] docs/openapi.yaml 有 paths: 却一条都没解析到——缩进/引号形式变了，先修解析器再谈覆盖数'
    );
    process.exitCode = 1;
    return;
  }
  const page = render(rows, pubCount, spec);
  if (check) {
    let prev = '';
    try {
      prev = readFileSync(OUT, 'utf8');
    } catch {
      prev = '';
    }
    if (prev.trim() !== page.trim()) {
      console.error('[FAIL] docs/api.md 与 server/src 路由不一致，请运行 pnpm api:gen 并提交');
      process.exitCode = 1;
    } else {
      console.log('OK：docs/api.md 与代码一致（' + rows.length + ' 条路由）');
    }
    return;
  }
  writeFileSync(OUT, page, 'utf8');
  console.log('已生成 docs/api.md：' + rows.length + ' 条路由（公开 ' + pubCount + ' 条）');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
