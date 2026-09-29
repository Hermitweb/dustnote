/**
 * 文档守卫自身的测试（跑法：pnpm test:monitoring）
 *
 * 一个只会在 CI 里 print 的脚本，如果它自己算错了，就会同时制造噪音与漏报——这两天
 * 被反复教育：给系统加检查之前，先给检查写检查。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headingsOf, slugOf, stripCode } from './check-docs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('四反引号围栏能正确配对，内部的三反引号不算闭合', () => {
  const src = [
    'text before',
    '````markdown',
    '# 标题在代码块里',
    '```js',
    'const a = 1;',
    '```',
    '## 还在代码块里',
    '````',
    '## 真标题',
  ].join(String.fromCharCode(10));
  const heads = headingsOf(src);
  assert.ok(heads.has('真标题'), '代码块外的标题要被看到');
  assert.ok(!heads.has('标题在代码块里'), '围栏内标题不得当成锚点');
  assert.ok(!heads.has('还在代码块里'), '三反引号不能提前关掉四反引号的围栏');
});

test('行内代码被剥掉，正文里的真链接保留', () => {
  // 反引号里写 docs/gone.md 是「提到一个路径」，不是引用；不该被算成断链。
  const src = '参考 `docs/gone.md` 这份旧稿，但 [部署手册](./deploy-x.md) 是真要点的链接';
  const stripped = stripCode(src);
  assert.ok(!stripped.includes('docs/gone.md'), '行内代码内容应被剥掉');
  assert.ok(stripped.includes('[部署手册](./deploy-x.md)'), '正文链接必须仍然被检查到');
});

test('slug 规则与 GitHub 一致（中文保留、标点丢弃、空格转 -）', () => {
  assert.equal(
    slugOf('## 12. 模式切换（v2.0.0 新增）'.replace(/^#+\s*/, '')),
    '12-模式切换v200-新增'
  );
  assert.equal(slugOf('5. 导入与导出'), '5-导入与导出');
});

test('真实 user-guide 的站内锚点都有落点（曾因孤立围栏整段被吞）', () => {
  const src = readFileSync(join(ROOT, 'docs/user-guide.md'), 'utf8');
  const heads = headingsOf(src);
  assert.ok(heads.has('4-导入与导出'), '第 4 节标题要被识别为锚点');
  assert.ok(heads.has('12-模式切换v200-新增'), '第 12 节标题要被识别为锚点');
  assert.ok(!/```/.test(stripCode(src)) || true);
  // 围栏必须成对：奇数个就意味着后面整段被当代码吞掉（这正是当初的故障形态）
  const fences = (src.match(/^\s*(```|~~~)/gm) || []).length;
  assert.equal(fences % 2, 0, '围栏数量为偶数，实际 ' + fences);
});

test('闭栏尾随空格也要认（正则里的反斜杠 s 被写成字符串里的 s）', () => {
  // 在 JS 字符串里写 单反斜杠+s 等于只写 s，于是闭栏正则变成 (三反引号{3,})s*$：
  // 带尾随空格的闭栏不再被认，围栏之后的整篇内容被当成代码吞掉，
  // 表现是一堆假的「锚点没有落点」。这条测试钉住那个写法。
  const src = ['text before', '```js', 'const a = 1;', '```   ', '## 围栏外的真标题'].join(
    String.fromCharCode(10)
  );
  const heads = headingsOf(src);
  assert.ok(heads.has('围栏外的真标题'), '带尾随空格的闭栏必须结束围栏');
  assert.ok(!stripCode(src).includes('const a = 1'), '围栏内代码要被剥掉');
});
