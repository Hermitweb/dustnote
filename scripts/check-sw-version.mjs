/**
 * SW_VERSION 一致性门禁（CI lint job 调用）
 *
 * web/public/sw.js 的 SW_VERSION 形如 `dustnote-v<version>-<序列>`。
 * 版本前缀必须与根 package.json 一致——此前曾停滞在 2.5.34 而应用已到
 * 2.5.38,导致 activate 阶段的旧 static 缓存永不清理（审计 M18）。
 * 发版 bump 时 sw.js 在 26 文件清单内,本脚本作为 CI 兜底探测。
 */
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const sw = readFileSync('web/public/sw.js', 'utf8');

const m = sw.match(/const SW_VERSION = 'dustnote-v([0-9]+\.[0-9]+\.[0-9]+)(?:-\d+)?'/);
if (!m) {
  console.error('✗ web/public/sw.js 未找到 SW_VERSION 常量（期望形如 dustnote-v<semver>-<seq>）');
  process.exit(1);
}
const swVersion = m[1];
if (swVersion !== pkg.version) {
  console.error(`✗ SW_VERSION ${swVersion} != package.json ${pkg.version}`);
  console.error('  发版时请同步推进 web/public/sw.js 的 SW_VERSION（末尾 -N 序列号+1）');
  process.exit(1);
}
console.log(`✓ SW_VERSION ${swVersion} 与 package.json 一致`);
