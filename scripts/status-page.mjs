#!/usr/bin/env node
/**
 * docs/status.md 的「生成区 / 人工区」读写助手。
 *
 * 单独成模块的原因：bump-version.mjs 是"import 即执行"的发版脚本，内部逻辑测不到，
 * 而下面这条规矩恰恰是发版当天会出事的地方，必须有回归测试钉住——
 *
 * **生成区（`status-probe:start/end` 之间）只能由探针写。**
 *
 * v2.5.47 发版实测（这就是本模块存在的理由）：版本号统一 bump 把生成区里的
 * 「期望版本 v2.5.46」「线上 **v2.5.46**（探针判定）」一并改写成了 2.5.47，
 * 页面于是声称"探针判定线上已是 2.5.47"，而那一刻线上还在跑 2.5.46——
 * 下一次真拨测（3 小时后）判红并开了 issue。发版脚本对生成区的处置必须是
 * **逐字节保留**，哪怕改的方向是"往新的改"；历史记录里写着旧版本号是事实，不是残留。
 *
 * 人工区则只允许归一「客户端渠道表」（那是"我们发布了什么"的事实）。
 */

/** 生成区（含两侧标记）。`[\s\S]*?` 非贪婪：同文件出现多段时只认第一段。 */
const PROBE_BLOCK = /<!-- status-probe:start -->[\s\S]*?<!-- status-probe:end -->/;

/**
 * 渠道表行的版本单元格：`| 渠道 | 2.5.46 | …`（只认"整格就是版本号"的行）。
 * 单元格两侧容忍**任意空白**：prettier 会按列宽对齐，短版本号（如 2.0.0）会被补成
 * 两个空格（`| Web | 2.0.0  |`）——只认单个空格的旧写法会静默漏掉这种行，
 * 而"渠道表没跟着发版走"正是这个文件最容易出的错。夹具换用解耦假版本时当场暴露。
 */
const TABLE_VERSION = /(\|[^|\n]+\|\s+)\d+\.\d+\.\d+(\s*\|)/g;

/** 取出生成区原文（含标记）；没有生成区时返回空串。 */
export function probeBlock(src) {
  const m = src.match(PROBE_BLOCK);
  return m ? m[0] : '';
}

/**
 * 摘掉生成区，返回人工区。
 * 残留自检用：生成区里的旧版本号是**拨测时刻的历史记录**，不是"清单外漏改"。
 */
export function stripProbeBlock(src) {
  return src.replace(PROBE_BLOCK, '');
}

/**
 * 归一渠道表版本号：生成区逐字节保留，人工区只替换表格行里的版本单元格。
 * 返回 `{ text, changed }`（changed 用于发版脚本记日志，不写盘的路径也要能调用）。
 */
export function normalizeStatusPage(src, newVersion) {
  const norm = (s) => s.replace(TABLE_VERSION, (_m, pre, post) => `${pre}${newVersion}${post}`);
  const m = src.match(PROBE_BLOCK);
  const text = m
    ? norm(src.slice(0, m.index)) + m[0] + norm(src.slice(m.index + m[0].length))
    : norm(src);
  return { text, changed: text !== src };
}
