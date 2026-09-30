#!/usr/bin/env node
/**
 * 文档一致性守卫（pnpm docs:check）
 *
 * 起因：整理前仓库里有 34 条断链，其中 18 条指向一套早已不存在的 .trae/documents/*，
 * 而 prettier、eslint、类型检查、单测、CI 全部照常通过——文档坏了没有任何门禁会吭。
 * 这和这两天处理过的「哨兵自己没站起来」是同一类问题：没人检查的东西一定烂。
 *
 * 它现在多了一层责任：官网的文档卡片指向仓库里的相对路径文档，断一条就是一个 404。
 *
 * 检查项（任一失败 exit 1）：
 *  1. 相对链接可达（先剥掉代码块与行内代码——里面的假链接是示例不是引用）；
 *  2. 站内锚点可达：[文字](#节) 必须对得上某个真实标题；
 *  3. 不得再引用仓库里不存在的 .trae/ 路径；
 *  4. docs/ 下每篇（archive 除外）都要被索引提到——孤儿文档等于不存在。
 *     官网的文档卡片与 README 的文档表都靠人找得到它们。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');
const relOf = (abs) =>
  abs
    .slice(ROOT.length + 1)
    .split(sep)
    .join('/');
const mdFiles = [];

function collect(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== 'node_modules' && !ent.name.startsWith('.')) collect(abs);
      continue;
    }
    if (/\.mdx?$/.test(ent.name)) mdFiles.push(relOf(abs));
  }
}

/**
 * 剥掉围栏代码块与行内代码：里面的 [x](y) 与 # 标题都是示例，不是引用。
 *
 * 围栏按 CommonMark 配对：开栏是 3 个以上连续的 ` 或 ~（可带信息串），闭栏必须同种字符、
 * 不短于开栏、且不带信息串。第一版只认三个反引号，而 user-guide.md 用四反引号包了一段
 * markdown 示例——状态机一错位，整篇的标题与链接都读丢了，表现成一堆「锚点没有落点」的
 * 假故障。规则型的东西不能凭感觉写。
 */
export function stripCode(src) {
  const out = [];
  let fence = null;
  for (const line of src.split(/\r?\n/)) {
    if (fence) {
      const close = new RegExp('^ {0,3}(' + fence.char + '{' + fence.len + ',})\\s*$');
      out.push('');
      if (close.test(line)) fence = null;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})[^`~]*$/.exec(line);
    if (open) {
      fence = { char: open[1][0] === '`' ? '`' : '~', len: open[1].length };
      out.push('');
      continue;
    }
    out.push(line.replace(/`+[^`]*`+/g, ''));
  }
  return out.join('\n');
}
// GitHub slug：小写、丢掉除字母数字/中文/空格/连字符之外的字符，空格转 -
export function slugOf(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

export function headingsOf(src) {
  const set = new Set();
  const re = /^ {0,3}#{1,6}\s+(.+?)\s*#*$/;
  for (const line of stripCode(src).split('\n')) {
    const m = re.exec(line);
    if (m) set.add(slugOf(m[1]));
  }
  return set;
}

/** 真正的检查：只在作为脚本执行时跑，被测试 import 时不产生副作用。 */
function main() {
  collect(ROOT);
  mdFiles.sort();

  const heads = new Map();
  for (const f of mdFiles) heads.set(f, headingsOf(readFileSync(join(ROOT, f), 'utf8')));

  const problems = [];
  let linkCount = 0;
  let anchorCount = 0;
  // 索引 = 根 README + 该文件各级祖先目录的 README。
  // 只看两个根索引会把 docs/adr/* 报成孤儿——它们明明被 docs/adr/README.md 索引着。
  const idxCache = new Map();
  function indexTextFor(file) {
    const parts = [];
    const segs = file.split('/');
    const chain = ['README.md'];
    for (let i = 0; i < segs.length - 1; i++)
      chain.push(segs.slice(0, i + 1).join('/') + '/README.md');
    for (const p of chain) {
      if (!idxCache.has(p))
        idxCache.set(p, existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '');
      parts.push(idxCache.get(p));
    }
    return parts.join('\n');
  }

  for (const f of mdFiles) {
    const raw = readFileSync(join(ROOT, f), 'utf8');
    const src = stripCode(raw);
    const own = heads.get(f);

    const linkRe = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;
    for (const m of src.matchAll(linkRe)) {
      const target = m[1];
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) continue;
      if (target.startsWith('#')) {
        anchorCount += 1;
        if (!own.has(target.slice(1))) problems.push(f + ' 的站内锚点没有落点：' + target);
        continue;
      }
      linkCount += 1;
      const file = target.split('#')[0];
      if (!file) continue;
      const abs = join(ROOT, dirname(f), file);
      if (!existsSync(abs)) problems.push(f + ' -> ' + target + '（目标不存在）');
    }

    if (f.startsWith('docs/') && !f.startsWith('docs/archive/')) {
      if (!f.endsWith('README.md') && !indexTextFor(f).includes(f.split('/').pop()))
        problems.push(f + ' 是孤儿文档：没有任何索引提到它');
    }
  }

  const payload = { files: mdFiles.length, links: linkCount, anchors: anchorCount, problems };
  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2));
  } else if (problems.length) {
    console.log(
      '扫描 ' +
        mdFiles.length +
        ' 个 markdown：本地链接 ' +
        linkCount +
        ' 条、站内锚点 ' +
        anchorCount +
        ' 条'
    );
    console.error('');
    console.error('[FAIL] 文档一致性检查失败：' + problems.length + ' 处');
    for (const p of problems.slice(0, 60)) console.error('  - ' + p);
    if (problems.length > 60) console.error('  …另有 ' + (problems.length - 60) + ' 处');
    console.error('');
    console.error('文档坏的时候没有任何东西会报警，所以它必须成为门禁。');
    process.exitCode = 1;
  } else {
    console.log(
      'OK：' +
        mdFiles.length +
        ' 个 markdown、' +
        linkCount +
        ' 条本地链接、' +
        anchorCount +
        ' 条站内锚点全部一致'
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
