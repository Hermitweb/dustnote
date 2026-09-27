#!/usr/bin/env node
/**
 * Docker 构建上下文守卫（v2.5.46 服务器升级事故固化）
 *
 * 事故模型：web/src/index.css `@import '../../shared/styles/tokens.css'`，而
 * Dockerfile 的 COPY 是白名单语义（只拷 shared/src 等）。CI 全源树构建与本地
 * vite build 都看不见这个缺口，fix 分支上 docker job 又被跳过（main-only），
 * 缺口一路活到服务器 upgrade.sh 现场构建才炸——"测试全绿但部署必挂"最坏类。
 *
 * 本脚本静态扫描前端源码的跨包相对引用（CSS @import / JS require / 字符串路径），
 * 归一为「顶层包/次级目录」，断言 Dockerfile 构建段的 COPY 白名单覆盖之。
 * 新增跨包资源目录而忘补 COPY 时立即 FAIL。
 *
 * 用法：node scripts/check-docker-context.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 1) 收集源码里的相对跨包引用（不经过 shell，避免转义地狱）──────────
const SCAN_DIRS = ['web/src', 'miniprogram/src', 'desktop/src', 'shared/src', 'client-core/src'];
// 包根的构建配置常 require 跨包资源（v2.5.46 二次升级实锤：
// web/tailwind.config.js require('../shared/tailwind-colors.mjs')），
// 与源码同等扫描——单列非递归收集，避免与 SCAN_DIRS 重叠遍历
const SCAN_ROOT_FILES = [
  'web/tailwind.config.js',
  'web/postcss.config.js',
  'web/vite.config.ts',
  'desktop/tailwind.config.js',
  'desktop/vite.config.ts',
  'miniprogram/config/index.js',
];
const EXT = /\.(css|scss|ts|tsx|js|mjs)$/;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(p);
    else if (EXT.test(name)) yield p;
  }
}

// 引用者 → 由 '../' 链回退解析到仓库根的相对路径。
// **跨包判定**：解析后路径的顶层目录 ≠ 引用文件自身的顶层目录才算跨
// （../../state/theme 从 pages/index 解出来仍在 miniprogram 内——同包噪音必须滤掉）
const refs = new Set();
function scanFile(file) {
  const ownTop = relative(ROOT, file).replace(/\\/g, '/').split('/')[0];
  const src = readFileSync(file, 'utf8');
  // 覆盖 @import '...' 与 require("...") 两族写法（v2.5.46 二次升级实锤：
  // tailwind.config.js 的 require('../shared/tailwind-colors.mjs') 属括号式，
  // 第一版正则只抓了引号式，被放走）
  for (const m of src.matchAll(/[(,'"\s]\s*['"`]((?:\.\.\/){1,6}[\w.@-]+(?:\/[\w.@*-]+)*)['"`]/g)) {
    const resolvedRel = relative(ROOT, resolve(dirname(file), m[1])).replace(/\\/g, '/');
    if (resolvedRel.startsWith('..')) continue; // 引用出仓库（外部相对），不管
    const refTop = resolvedRel.split('/')[0];
    if (refTop === ownTop) continue; // 同包内目录跳转，Dockerfile 的 COPY <pkg>/src 天然覆盖
    refs.add(resolvedRel);
  }
}
for (const scanDir of SCAN_DIRS) {
  for (const file of walk(resolve(ROOT, scanDir))) scanFile(file);
}
for (const rel of SCAN_ROOT_FILES) {
  const abs = join(ROOT, rel);
  try {
    if (statSync(abs).isFile()) scanFile(abs);
  } catch {
    /* 配置文件名随脚手架变化，缺失即跳过 */
  }
}

// ── 2) Dockerfile COPY 白名单（构建段，跳过 --from 多阶段拷贝）────────
const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
const copySources = [];
for (const m of dockerfile.matchAll(/^COPY\s+(?!--from)([^\n]+)$/gm)) {
  const parts = m[1].trim().split(/\s+/);
  const srcs = parts.length >= 2 ? parts.slice(0, -1) : parts; // 末参是目标
  for (const s of srcs) {
    if (s.startsWith('$') || s === '.') continue;
    copySources.push(s.replace(/\/+$/, ''));
  }
}

// 引用路径（如 shared/styles/tokens.css）被覆盖 = 某 COPY 源是它的祖先目录或自身
function covered(ref) {
  return copySources.some((c) => ref === c || ref.startsWith(c + '/'));
}

// 只校验「跨包目录级」资源引用（package.json/tsconfig 等安装清单在别处 COPY，
// 深度 ≤2 段的路径如 shared/src/x.ts 已被 COPY shared/src 覆盖——全部按结果判定）
const failures = [];
for (const ref of refs) {
  const segs = ref.split('/');
  // 不论深度——单文件跨包引用（shared/tailwind-colors.mjs）与目录级
  // （shared/styles/tokens.css）同等校验；深度 <3 放行会让文件级缺口溜走
  // （v2.5.46 二次升级实锤：tailwind.config.js require 单文件被放走）
  if (covered(ref)) continue;
  // 深层源码引用：其 <pkg>/src 顶层若已 COPY 则覆盖
  if (segs[1] === 'src' && copySources.includes(`${segs[0]}/src`)) continue;
  failures.push(ref);
}

if (failures.length) {
  console.error('[FAIL] 以下跨包资源引用未被 Dockerfile COPY 白名单覆盖：');
  for (const f of failures) console.error('  -', f);
  console.error('修复：构建段补 COPY <源目录> <目标目录>，或将引用改为构建期生成。');
  process.exit(1);
}
console.log(`✓ docker-context: ${refs.size} 条跨包引用全部被 COPY 白名单覆盖`);
