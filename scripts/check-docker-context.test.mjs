/**
 * check-docker-context 自测（spawn 冒烟）：脚本读真实 docker-compose.yml 并解析 ports。
 * 无导出纯函数（顶层直接执行的活体脚本），故用 spawn 验证「脚本在当前仓库状态下可执行 + exit 0」，
 * 锁住"脚本本身无语法/路径崩"这条最低线。compose 内容正确性由活体审计（脚本本体）保证。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-docker-context.mjs');

const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
assert.equal(
  r.status,
  0,
  `check-docker-context 应在当前仓库状态下 exit 0，实际=${r.status}\n${(r.stdout ?? '') + (r.stderr ?? '')}`
);
assert.match(r.stdout ?? '', /docker-context/);

console.log('✓ check-docker-context：spawn 冒烟断言通过');
