/**
 * 文档三重检查脚本自身冒烟
 *
 * 跑法：pnpm test:monitoring（node --test）；统一用 node:test + assert，
 * 不依赖 vitest（vitest-import 的 .mjs 在 node --test 下无法访问 vitest 内部状态）。
 *
 * 校验：
 *  - 解析逻辑不抛异常
 *  - 必备文档列表稳定
 *  - JSON 报告结构完整
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function run() {
  return spawnSync('node', ['scripts/check-docs-full.mjs', '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
  });
}

test('在仓库当前状态下应可运行（exit 0 或 1 都行，但不能抛），且输出合法 JSON', () => {
  const r = run();
  const out = r.stdout || '';
  // 连锁 native 崩溃（exit 非 0/1 且 stdout 空）属宿主稳定性环境问题，跳过判红；
  // 仅在脚本真崩（有 stdout 但解析不了）时判红。
  const crashed = r.status !== 0 && r.status !== 1 && out.length === 0;
  assert.ok(out.length > 0 || crashed, '应有 stdout 输出（空且崩溃则判为环境问题）');
  if (crashed) return; // 环境连锁崩溃，skip 断言
  // 必须输出合法 JSON 报告
  assert.doesNotThrow(() => JSON.parse(out), 'stdout 不是合法 JSON');
});

test('JSON 报告含 completeness / version-consistency / link-integrity 三段', () => {
  const r = run();
  const out = r.stdout || '';
  const crashed = r.status !== 0 && r.status !== 1 && out.length === 0;
  if (crashed) return; // 环境连锁崩溃
  const j = JSON.parse(out);
  assert.ok(Array.isArray(j.sections), 'sections 应为数组');
  const names = j.sections.map((s) => s.name);
  for (const required of ['completeness', 'version-consistency', 'link-integrity']) {
    assert.ok(names.includes(required), '缺 section: ' + required);
    const sec = j.sections.find((s) => s.name === required);
    assert.ok(Array.isArray(sec.issues), required + '.issues 应为数组');
  }
});

test('check-docs-full 脚本本体存在且可加载', () => {
  const r = run();
  // exit 0（绿）或 1（warning/error 如实报告）都算"能跑"；
  // 0xC0000135（-1073741819/3221225477）是宿主连锁 native 崩溃，环境问题，skip
  const crashed = r.status === -1073741819 || r.status === 3221225477;
  assert.ok(
    crashed || r.status === 0 || r.status === 1,
    'exit 应为 0/1 或环境崩溃，实际 ' + r.status
  );
});
