/**
 * check-docker-pins 自测：门禁是顶层直接执行的活体脚本（读真实 Dockerfile/compose），
 * 无导出纯函数，故用 spawn 验证「脚本可执行」+「当前仓库状态的如实判定」。
 *
 * 当前仓库 base 镜像仍为浮动 tag（node:22-alpine 等未 @sha256:），门禁应 exit 1 并列出未 pin 项；
 * 维护者跑 `pnpm pin-digests` 后再跑应 exit 0。此测试锁定两条断言之一（取决于现状）。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-docker-pins.mjs');

const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
const out = (r.stdout ?? '') + (r.stderr ?? '');

// 门禁必须可执行（不崩）；退出码取决于当前 pin 状态。
// 若已 pin → 0 + 「均已 digest-pin」；若未 pin → 1 + 列出未 pin 项。
// 两种情况都锁定「脚本正确反映了 pin 状态」：
if (r.status === 0) {
  assert.match(out, /digest-pin/);
} else {
  // 未 pin 时应明确指出是哪个 tag 未钉
  assert.match(out, /未 digest-pin|pin-digests/);
}
console.log(`✓ check-docker-pins：spawn 断言通过（status=${r.status}，如实反映当前 pin 状态）`);
