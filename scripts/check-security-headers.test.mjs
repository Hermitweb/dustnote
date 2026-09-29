/**
 * nginx 安全头继承守卫的测试（跑法：pnpm test:monitoring）
 *
 * 为什么要钉这条规则：nginx 的 add_header 不继承——某个 location 只要自己声明过
 * 任意一条 add_header（哪怕只是 Cache-Control: no-store），父级那一整套安全头就从
 * 这条路径的响应上消失了。线上实测到后果：/api/ 与 /metrics 各写了 Cache-Control，
 * 于是 nginx 的 CSP、frame-ancestors 'none'、长 HSTS 都不在它们的响应上（helmet 自己
 * 那套 JSON 向的头还在，所以不是裸奔，是防线悄悄降级）。配置文本里看不出来。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './check-security-headers.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const SEC = [
  'Strict-Transport-Security',
  'Content-Security-Policy',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
  'Permissions-Policy',
];

// 造一个 server 块：headers 里的每条都变成 add_header
function serverWith(headers, inner) {
  const decls = headers.map((h) => '    add_header ' + h + ' "x" always;').join('\n');
  return 'server {\n' + decls + (inner ? '\n' + inner : '') + '\n}';
}

test('真实 deploy/nginx.conf：每个 location 的有效头都齐', () => {
  const src = readFileSync(join(ROOT, 'deploy/nginx.conf'), 'utf8');
  const { required, locations } = analyze(src);
  assert.ok(required.includes('Content-Security-Policy'), 'server 级必须声明 CSP');
  assert.equal(required.length, 6);
  assert.ok(locations.length >= 5, 'location 数应不少于 5，实际 ' + locations.length);
  for (const loc of locations) {
    assert.deepEqual(loc.missing, [], loc.name + ' 缺头: ' + loc.missing.join(', '));
  }
});

test('自带 add_header 却不重述安全头的 location → 被抓', () => {
  const inner = '    location /api/ {\n        add_header Cache-Control "no-store" always;\n    }';
  const { locations } = analyze(serverWith(SEC, inner));
  const api = locations.find((l) => l.name.includes('/api/'));
  assert.ok(api, '应解析出 /api/ location');
  assert.equal(api.missing.length, 6, '应报缺 6 条，实际 ' + api.missing.length);
  assert.ok(api.missing.includes('Content-Security-Policy'));
});

test('没有 add_header 的 location 正常继承 → 不误报', () => {
  const inner = '    location /downloads/ {\n        try_files $uri =404;\n    }';
  const { locations } = analyze(serverWith(SEC, inner));
  assert.deepEqual(locations[0].missing, []);
  assert.equal(locations[0].own.length, 0);
});

test('嵌套层按同一规则重算：外层丢了，内层跟着丢', () => {
  // 内层一行 add_header 都没写，直觉会说它继承 server；但 nginx 是从上一层继承，
  // 而上一层（location /）已经因为自带 Cache-Control 而脱离了继承链。
  const inner =
    '    location / {\n        add_header Cache-Control "public" always;\n' +
    '        location ~* \\.(js)$ {\n            expires 30d;\n        }\n    }';
  const { locations } = analyze(serverWith(SEC, inner));
  assert.equal(locations.length, 2);
  for (const loc of locations) {
    assert.equal(loc.missing.length, 6, loc.name + ' 应报缺 6 条');
  }
});

test('server 级自己漏了 CSP → required 里就没有，不假装通过', () => {
  const { required } = analyze(serverWith(SEC.filter((h) => h !== 'Content-Security-Policy')));
  assert.ok(!required.includes('Content-Security-Policy'));
});

test('注释里的 add_header 不算数', () => {
  const inner =
    '    location /a/ {\n        # add_header Cache-Control "x" always;\n    }\n' +
    '    location /b/ {\n        add_header Cache-Control "x" always;\n    }';
  const { locations } = analyze(serverWith(SEC, inner));
  const a = locations.find((l) => l.name.includes('/a/'));
  const b = locations.find((l) => l.name.includes('/b/'));
  assert.deepEqual(a.missing, [], '整条被注释 = 本层无 add_header = 继承父级');
  assert.equal(b.missing.length, 6);
});
