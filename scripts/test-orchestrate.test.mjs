/**
 * test-orchestrate 自身冒烟（保证 STEPS 列表与 flag 解析稳）
 *
 * 跑法：pnpm test:monitoring（node --test）；统一 node:test + assert。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('--help / --json 不报错（dry parse），输出合法 JSON', () => {
  const r = spawnSync('node', ['scripts/test-orchestrate.mjs', '--only', '__noop__', '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
  });
  // --json 输出是多行 JSON，整体解析（非末行）
  const out = (r.stdout || '').trim();
  // 取 JSON 部分（SKIP 行之前/之后都可能有，--only __noop__ 时全 skip，stdout 应是纯 JSON）
  const jsonStart = out.indexOf('{');
  const jsonText = jsonStart >= 0 ? out.slice(jsonStart) : out;
  assert.doesNotThrow(() => JSON.parse(jsonText), '输出不是合法 JSON: ' + jsonText.slice(0, 200));
});

test('unknown only flag 应当 pass=0（其余 skip），exit 0', () => {
  const r = spawnSync(
    'node',
    ['scripts/test-orchestrate.mjs', '--only', 'definitely-no-such-step'],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 }
  );
  assert.equal(r.status, 0, 'unknown step 应 exit 0（skip 不算失败），实际 ' + r.status);
});
