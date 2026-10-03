/**
 * docs/status.md 分区读写的回归测试（跑法：pnpm test:monitoring）
 *
 * 为什么必须有：v2.5.47 发版实测——版本号统一 bump 把**探针生成区**里的
 * 「期望版本 v2.5.46 / 线上 **v2.5.46**（探针判定）」一并改写成 2.5.47，
 * 页面于是声称"探针判定线上已是新版本"，而线上还在跑旧版；三小时后真拨测判红开 issue。
 * 这条规矩（生成区只能由探针写）此前没有任何断言看着，全靠人工记得——
 * 那就等于下次还会再犯。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeBlock, stripProbeBlock, normalizeStatusPage } from './status-page.mjs';

/**
 * 一份形状贴近真文档的夹具：生成区（探测表——含一条"整格版本号"的毒丸行 + 两处散文版本提及） + 人工区渠道表。
 * 版本号一律用**与仓库解耦的假版本**（api.test 的 2.99.0 先例）：夹具若跟着真版本走，
 * 每次发版都会被 bump 的残留自检逮住，逼着人来改测试——那是把发布工具的成本转嫁给夹具。
 */
const FIXTURE = `# DustNote 服务状态

<!-- status-probe:start -->

> 最近拨测：2026-10-03 03:20 UTC · 🟢 全部通过 · 期望版本 v7.7.7

**当前状态：🟢 正常** — 线上 **v7.7.7**（探针判定，非人工声明）

| 探测项    | 结果 | 耗时  | HTTP | 说明   |
| --------- | ---- | ----- | ---- | ------ |
| health    | ✅   | 290ms | 200  | 7.7.7  |
| web       | ✅   | 20ms  | 200  |        |

<!-- status-probe:end -->

## 客户端渠道

| 渠道          | 版本   | 分发方式             |
| ------------- | ------ | -------------------- |
| Web / PWA     | 1.0.0  | 服务器直出           |
| Windows x64   | 1.0.0  | 应用内更新           |
| iOS           | —      | 未发布               |

## 历史事件

- 2026-09-03：v1.0.1 发布当日出现一次误报（叙事里的旧版本号，不属于任何清单）。
`;

const NEW = '2.0.0';

test('生成区逐字节保留：含表格与两处版本提及都不许动', () => {
  const { text, changed } = normalizeStatusPage(FIXTURE, NEW);
  assert.equal(changed, true, '渠道表应发生更新');
  // 整段生成区（含假想的那条"7.7.7 语义锚"表格行）必须一字不差
  assert.equal(probeBlock(text), probeBlock(FIXTURE));
  assert.ok(text.includes('期望版本 v7.7.7'), '生成区的"期望版本"是拨测时刻的历史记录');
  assert.ok(text.includes('线上 **v7.7.7**'), '生成区的"线上版本"是拨测时刻的历史记录');
  // 这条行是"毒丸"：它长得和渠道表行一模一样。生成区若被整文件正则扫到，
  // 它会第一个被改写——变异验证（去掉分段）就是靠它判红。
  assert.ok(probeBlock(text).includes('| 7.7.7  |'), '生成区里"整格版本号"的行同样不许改写');
});

test('人工区的渠道表更新到新版本', () => {
  const { text } = normalizeStatusPage(FIXTURE, NEW);
  assert.ok(text.includes('| Web / PWA     | 2.0.0  |'), '渠道表 Web 行应更新');
  assert.ok(text.includes('| Windows x64   | 2.0.0  |'), '渠道表 Windows 行应更新');
  assert.ok(text.includes('| iOS           | —      |'), '没有版本号的行保持原样');
});

test('叙事里的旧版本号不归发版管（历史不能跟着 bump 改口）', () => {
  const { text } = normalizeStatusPage(FIXTURE, NEW);
  assert.ok(text.includes('v1.0.1 发布当日'), '正文叙事里的旧版本号应原样保留');
});

test('没有生成区时退化为纯渠道表归一（不报错、不多改）', () => {
  const bare = '| 渠道 | 版本 |\n| --- | --- |\n| Web | 1.0.0 |\n';
  const { text, changed } = normalizeStatusPage(bare, NEW);
  assert.equal(changed, true);
  assert.ok(text.includes('| Web | 2.0.0 |'));
  assert.equal(probeBlock(bare), '', '无生成区时 probeBlock 应为空串');
});

test('已是新版本时 changed=false（可重复执行，幂等）', () => {
  const once = normalizeStatusPage(FIXTURE, NEW).text;
  const twice = normalizeStatusPage(once, NEW);
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once);
});

test('stripProbeBlock 只摘生成区：供残留自检按"生成区之外"判残留', () => {
  const outside = stripProbeBlock(FIXTURE);
  assert.ok(!outside.includes('status-probe:start'), '标记应一并摘除');
  // 生成区独有的三处文本都该消失（人工区里同样有版本号，那是另一回事，必须留下）
  assert.ok(!outside.includes('期望版本 v7.7.7'), '生成区的"期望版本"不应留在人工区');
  assert.ok(!outside.includes('线上 **v7.7.7**'), '生成区的"线上版本"不应留在人工区');
  assert.ok(!outside.includes('290ms'), '生成区内的探测结果行不应留在人工区');
  assert.ok(outside.includes('| Web / PWA     | 1.0.0  |'), '人工区内容原样保留');
});
