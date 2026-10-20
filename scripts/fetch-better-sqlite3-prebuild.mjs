/**
 * 从 GitHub 拉取 better-sqlite3 的 Node 22 ABI（NODE_MODULE_VERSION 127）预编译二进制，
 * 替换 node_modules 里 Node 24 编译的 .node（当前 ERR_DLOPEN_FAILED 的根因）。
 *
 * better-sqlite3 的 prebuilds 发在 release 里（prebuild-install 的源）。
 * 运行：node scripts/fetch-better-sqlite3-prebuild.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BSQL = join(ROOT, 'node_modules', 'better-sqlite3');

// 读包版本，构造 release asset 名
const ver = JSON.parse(readFileSync(join(BSQL, 'package.json'), 'utf8')).version;
// prebuild-install 默认按 napi 名：better-sqlite3-v{ver}-napi-v{n}-win32-x64.tar.gz
// napi 版本在 binding.gypi 的 cflags / node_api 里；better-sqlite3 12.x 用 napi 9
const napi = 9;
const asset = `better-sqlite3-v${ver}-napi-v${napi}-win32-x64.tar.gz`;
const url = `https://github.com/planetsql/better-sqlite3/releases/download/v${ver}/${asset}`;

console.log(`[fetch-prebuild] 包版本 ${ver}，拉 ${asset}`);
console.log(`[fetch-prebuild] URL: ${url}`);

const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) {
  console.error(`[fetch-prebuild] HTTP ${res.status} ${res.statusText}`);
  process.exit(2);
}
const buf = Buffer.from(await res.arrayBuffer());
writeFileSync(join(ROOT, `better-sqlite3-prebuild.tar.gz`), buf);
console.log(`[fetch-prebuild] 已下载 ${buf.length} bytes → better-sqlite3-prebuild.tar.gz`);

// 解压
const { execSync } = await import('node:child_process');
const tarDir = join(ROOT, 'better-sqlite3-prebuild-extract');
execSync(`tar -xzf "${ROOT}\\better-sqlite3-prebuild.tar.gz" -C "${tarDir}"`);
const inner = readdirSync(tarDir, { recursive: true }).filter((f) => f.endsWith('.node'));
if (!inner.length) {
  console.error('[fetch-prebuild] 解压后没找到 .node');
  process.exit(3);
}
// 复制覆盖现有 better_sqlite3.node
const target = join(BSQL, 'build', 'Release', 'better_sqlite3.node');
const src = join(tarDir, inner[0]);
writeFileSync(target, readFileSync(src));
console.log(`[fetch-prebuild] 已覆盖 ${target}`);

// 验证
try {
  const D = await import('better-sqlite3').catch(() => require('better-sqlite3'));
  const Ctor = D.default ?? D;
  const db = new Ctor(':memory:');
  db.exec('CREATE TABLE t(x TEXT)');
  console.log(
    '[fetch-prebuild] 验证 OK:',
    db.prepare('SELECT ? AS x').get('better-sqlite3-napi-v127')
  );
  db.close();
} catch (e) {
  console.error('[fetch-prebuild] 验证失败:', e.message.slice(0, 200));
  process.exit(4);
}
console.log('[fetch-prebuild] ✅ better-sqlite3 已为 Node 22 ABI 重建，DB 可用');
