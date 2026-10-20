/**
 * check-readme-version 自测（spawn 冒烟）：脚本读真实 package.json 与 README.md，比对 status-v 徽章。
 * 无导出纯函数，故用 spawn 验证「脚本在当前仓库状态下可执行 + exit 0」。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-readme-version.mjs');

const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
assert.equal(
  r.status,
  0,
  `check-readme-version 应在当前仓库状态下 exit 0，实际=${r.status}\n${(r.stdout ?? '') + (r.stderr ?? '')}`
);
assert.match(r.stdout ?? '', /README 徽章版本与 package\.json 一致/);

console.log('✓ check-readme-version：spawn 冒烟断言通过');
