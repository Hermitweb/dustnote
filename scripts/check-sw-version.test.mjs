/**
 * check-sw-version 自测（薄壳 spawn）：脚本读「相对 cwd」的 package.json 与 web/public/sw.js，
 * 比较 SW_VERSION 前缀与 package.json 版本。此处用临时目录伪造两份文件，spawn 脚本验证：
 *   - 一致 → exit 0；
 *   - 不一致 → exit 1；
 *   - sw.js 缺 SW_VERSION → exit 1。
 * 不读真实仓库文件（那是活体审计），只测脚本逻辑路径。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-sw-version.mjs');

function run(tmp, pkgVer, swBody) {
  mkdirSync(join(tmp, 'web/public'), { recursive: true });
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ version: pkgVer }));
  writeFileSync(join(tmp, 'web/public/sw.js'), swBody);
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: tmp, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

const tmp = mkdtempSync(join(tmpdir(), 'sw-ver-test-'));

// 一致 → 0
{
  const r = run(tmp, '2.99.0', "const SW_VERSION = 'dustnote-v2.99.0-4';");
  assert.equal(r.code, 0, `一致应通过，实际 code=${r.code}\n${r.out}`);
  assert.match(r.out, /SW_VERSION 2\.99\.0/);
}

// 不一致 → 1
{
  const r = run(tmp, '2.99.1', "const SW_VERSION = 'dustnote-v2.99.0-4';");
  assert.equal(r.code, 1, `不一致应失败，实际 code=${r.code}\n${r.out}`);
  assert.match(r.out, /!=/);
}

// 缺 SW_VERSION 常量 → 1
{
  const r = run(tmp, '2.99.0', '// 无 SW_VERSION 的 sw.js');
  assert.equal(r.code, 1, `缺常量应失败，实际 code=${r.code}\n${r.out}`);
}

console.log('✓ check-sw-version：spawn 薄壳 3 路径断言通过');
