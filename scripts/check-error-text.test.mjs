/**
 * check-error-text 门禁自身的测试（跑法：pnpm test:monitoring）
 *
 * 规矩来自 scripts/README「每条门禁都要有 .test.mjs」+「从没红过的门禁等于没有门禁」：
 * 这里既测**命中口径**（各类裸 .message 形态要抓到、豁免形态要放过），
 * 也测**真实仓库干净**（scanRoot 跑全仓，ALLOWLIST 被误删时会在这里变红）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findViolations, scanRoot } from './check-error-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 返回命中行号数组；行号从 1 起 */
const hitLines = (src, rel = 'web/src/screens/Demo.tsx') =>
  findViolations(src, rel).map((h) => h.line);

test('四类裸 message 形态全部命中', () => {
  assert.deepEqual(hitLines('const m = (err as Error).message;'), [1]);
  assert.deepEqual(hitLines('const m = err.message;'), [1]);
  assert.deepEqual(hitLines('const m = e?.message;'), [1]);
  assert.deepEqual(hitLines('show(error.message);'), [1]);
});

test('小程序胶水形态 err?.err?.message（无码嵌套载荷）也要命中', () => {
  assert.deepEqual(
    hitLines(
      'const msg = (err as { err?: { message?: string } })?.err?.message;',
      'miniprogram/src/pages/x/index.tsx'
    ),
    [1]
  );
});

test('行内标记豁免本行、以及紧随其后的一条语句（含跨行括号区域）', () => {
  // 标记在行尾：只豁免本行，下一条语句照常受检
  assert.deepEqual(hitLines('const m = err.message; // error-text-scope: payload  // 载荷'), []);
  assert.deepEqual(
    hitLines('const m = err.message; // error-text-scope: payload\nconst n = e.message;'),
    [2]
  );
  // 标记独占一行：覆盖紧随其后的那条语句；跨行 by 括号配平（auth.ts 的 recordNetworkSignal 形态）
  assert.deepEqual(
    hitLines('// error-text-scope: classifier\nconst m = err.message;\nconst n = e.message;'),
    [3]
  );
  // 跨行语句：区域直到左括号全部闭合才结束（auth.ts 的 recordNetworkSignal 形态）
  assert.deepEqual(
    hitLines(
      '// error-text-scope: payload\nrecordNetworkSignal(\n  `x: ${e.message}`\n);\nconst n = e.message;'
    ),
    [5]
  );
  // 注释行里的引文不算命中（本脚本头注释同款形态）
  assert.deepEqual(hitLines(' * 举例：err.message 直出不可取\nconst m = err.message;'), [2]);
});

test('errorText(err) 调用本身不算违例（纪律正解）', () => {
  assert.deepEqual(hitLines("Alert.alert(t('x.failed'), errorText(err));"), []);
});

test('ALLOWLIST 文件整文件豁免', () => {
  assert.deepEqual(hitLines('const m = err.message;', 'web/src/main.tsx'), []);
  assert.deepEqual(
    hitLines('const m = err.message;', 'web/src/components/AppErrorBoundary.tsx'),
    []
  );
});

test('真实仓库当前干净：scanRoot 零命中（违例回归会在此变红）', () => {
  assert.deepEqual(scanRoot(ROOT), []);
});

test('ALLOWLIST 每条指向真实存在的文件（防改名悬空豁免）', () => {
  // 直接从源码文本取清单，避免再导出一个符号扩大公共面
  const src = readFileSync(join(ROOT, 'scripts/check-error-text.mjs'), 'utf8');
  const entries = [...src.matchAll(/^\s*'((?:web|mobile|miniprogram)\/[^']+)'/gm)].map((m) => m[1]);
  assert.ok(entries.length >= 5, `应能解析到 ALLOWLIST 条目，实际 ${entries.length}`);
  for (const e of entries) assert.ok(existsSync(join(ROOT, e)), `ALLOWLIST 指向不存在的文件: ${e}`);
});
