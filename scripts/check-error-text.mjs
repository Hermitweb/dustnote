#!/usr/bin/env node
/**
 * check-error-text.mjs — 用户可见错误必须走 errorText 的门禁（2026-10-08 沉淀）
 *
 * 背景（全端审计 2026-10-07 W-L1~8）：`err.message` / `(err as Error).message`
 * 直出给用户，会把服务端英文原文、AbortError 技术黑话、「目标不存在或已被删除」
 * 之类的桶文案塌缩直接甩到 toast/弹窗上——同一类回归在 2026-09-24 真机审计、
 * 2026-10-07 网页审计里各复发一次。规矩本身写在 CONTRIBUTING.md；此脚本防回潮。
 *
 * 用法：node scripts/check-error-text.mjs [--json]
 * 退出码：0 = 通过，1 = 有未豁免的命中
 *
 * 判定口径（对齐 shared/src/error-codes.ts 的 errorReason 语义）：
 *   命中 = 代码行**读取异常对象的 message 属性**。豁免只有两种：
 *   1. 行内标记 `error-text-scope: classifier|payload`——语义是「这行（或紧随
 *      其后的这条语句）只用于关键词分桶 / 诊断载荷序列化，不直出 UI」。可以
 *      写在命中行的行尾注释里，也可以单独占一行覆盖**紧随其后的那条语句**
 *      （跨行 by 括号配平：标记开启区域，直到左括号全部闭合才结束，中间的
 *      注释行不打断区域）。
 *   2. ALLOWLIST 文件级豁免（整文件性质使然，逐条附理由——仿 bump-version 的
 *      RESIDUAL_ALLOW 惯例，理由即文档，撤豁免前先读理由）。
 *   纯注释行（// 开头、块注释的星号行）永远不算命中——文档里举例 `err.message`
 *   不会误报；行尾注释里的引文同样按行尾注释剥掉后再匹配。
 *
 * 局限性：正则不辨作用域——变量名叫 err 的普通对象（如队列条目 {kind,message}
 * 去重）也会被命中；这类点用行内标记豁免，误报成本 = 一个注释。含 `//` 的
 * 字符串字面量会被当成行尾注释截断（宁可漏括号配平，不可误报用户可见文案）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** 扫描范围：三端 src（desktop/server 的错误展示不在本纪律内——桌面走 Tauri 插件、服务端无 UI） */
const SCAN_DIRS = ['web/src', 'mobile/src', 'miniprogram/src'];

/** 读取异常 message 属性的形态（含小程序 err?.err?.message 嵌套取法） */
const RAW_MESSAGE_RE = /\bas\s+Error\)\.message|\b(?:err|error|e)\??\.(?:err\??\.)?message\b/;

/** 行内豁免标记：error-text-scope: classifier|payload ——同行行尾或紧邻上一行 */
const SCOPE_MARKER_RE = /error-text-scope:\s*(classifier|payload)\b/;

/**
 * 文件级豁免（相对路径）。每条必须写理由——门禁的意义在于豁免清单短且可审计，
 * 新增条目请附「为什么整文件都不算用户直出」。
 */
const ALLOWLIST = [
  // ── 崩溃兜底屏：展示 raw 是设计本身（带错误码供用户报障），且各自有生产护栏 ──
  'web/src/main.tsx', // Sentry ErrorBoundary：PROD 分支隐藏 raw，dev 才显示（审计 W-L8 定样）
  'web/src/components/AppErrorBoundary.tsx', // 同上：logger 载荷 + 崩溃页 pre，用户主动展开才可见
  'mobile/src/components/ErrorBoundary.tsx', // __DEV__ 三元护栏，生产只展示通用文案
  // ── 诊断/上报载荷：message 进的是队列/日志/logcat，不是 toast ──
  'web/src/lib/error-reporter.ts', // 诊断事件队列（enqueueDiagEvent 的本体）
  'mobile/src/lib/diagnostics.ts', // 同上：recordDiagEvent 载荷 + 队列去重比较
  // ── 非服务端异常的载荷序列化（errorText 无从分桶）──
  'web/src/lib/argon2-worker.ts', // worker postMessage 协议字段（{id, error}），主线程重包 Error
  'web/src/lib/use-update-check.ts', // 更新检查结果 {status:'error', message} 载荷
  'mobile/src/lib/use-update-check.ts', // 同上（安卓端）
];

function walk(dirAbs) {
  const out = [];
  for (const name of readdirSync(dirAbs)) {
    const full = join(dirAbs, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

export function findViolations(srcAbs, relPath) {
  if (ALLOWLIST.includes(relPath)) return [];
  const lines = srcAbs.split('\n');
  const hits = [];
  let inScope = false; // 上一个标记开启了「覆盖后续语句」的区域
  let depth = 0; // 区域内未闭合的左括号数：归零即语句结束
  lines.forEach((raw, i) => {
    const trimmed = raw.trim();
    const marked = SCOPE_MARKER_RE.test(raw);
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      if (marked) {
        inScope = true;
        depth = 0;
      }
      return; // 注释行永不判命中，也不打断区域
    }
    const code = raw.split('//')[0]; // 行尾注释剥掉后再匹配（标记本身按原行判）
    const covered = marked || inScope;
    if (RAW_MESSAGE_RE.test(code) && !covered) hits.push({ line: i + 1, text: trimmed });
    if (inScope) {
      depth = Math.max(
        0,
        depth + (code.match(/\(/g) || []).length - (code.match(/\)/g) || []).length
      );
      if (depth === 0) inScope = false;
    }
  });
  return hits;
}

export function scanRoot(root = ROOT) {
  const violations = [];
  for (const d of SCAN_DIRS) {
    const abs = join(root, d);
    let files;
    try {
      files = walk(abs);
    } catch {
      continue; // 目录不存在（裁剪过的 checkout）：跳过而非炸掉
    }
    for (const f of files) {
      const rel = relative(root, f).split(sep).join('/');
      const hits = findViolations(readFileSync(f, 'utf8'), rel);
      if (hits.length) violations.push({ file: rel, hits });
    }
  }
  return violations;
}

function main() {
  const violations = scanRoot();
  const asJson = process.argv.includes('--json');
  if (asJson) {
    console.log(JSON.stringify({ violations }, null, 1));
  } else if (violations.length === 0) {
    console.log(
      `✓ error-text 纪律：三端用户可见路径无裸 err.message 直出（豁免 ${ALLOWLIST.length} 文件）`
    );
  } else {
    console.error(`✗ 以下位置把异常 message 直出（或读取）而未走 errorText：`);
    for (const v of violations) {
      for (const h of v.hits) console.error(`  ${v.file}:${h.line}  ${h.text}`);
    }
    console.error(
      `\n  修法：展示点换 errorText(err)（web/mobile/miniprogram 各有 lib/error-text.ts 胶水）；\n` +
        `  确属分桶判定/诊断载荷，在该行加注释 error-text-scope: classifier|payload + 一句话理由；\n` +
        `  整文件性质使然才进 ALLOWLIST（附理由）。详见 CONTRIBUTING.md「错误展示纪律」。`
    );
  }
  process.exit(violations.length > 0 ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
