#!/usr/bin/env node
/**
 * nginx 安全头继承守卫（起因：CodeQL #9 insecure-helmet-configuration）
 *
 * 那条告警说 express 的 helmet 把 CSP 关了。查下去发现：页面从来不由 express 发出——
 * 容器里 nginx 直接 root /app/web-dist 静态吐出，安全头也全在 deploy/nginx.conf 上。
 * 于是真正该问的不是「helmet 有没有开 CSP」，而是「每一条响应到底还带着那六个头吗」。
 *
 * 而这正是 nginx 容易静默失手的地方：**add_header 不继承**。某个 location 只要自己
 * 写过任意一条 add_header（哪怕只是 Cache-Control），父级那一整套安全头就全部不再
 * 出现在该路径的响应上。deploy/nginx.conf 因此在三处各抄了一遍同样的六条——
 * 「抄」本身不是问题，**漏抄**才是，而漏抄不会有任何报错：页面照常打开，头默默消失。
 *
 * 本脚本按 nginx 的真实规则重算每个 location 的**有效头集合**，断言它们都齐：
 *   有效集合 = 本层有 add_header ? 本层自己那几条 : 向上继承
 * 用法：node scripts/check-security-headers.mjs [路径]
 *   --json 机读输出；非 0 退出码表示有 location 缺头
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const CONF = arg ? resolve(arg) : join(ROOT, 'deploy/nginx.conf');
const AS_JSON = process.argv.includes('--json');

/** 去掉未被引号包裹的 # 注释（本配置的值里没有 #，够用了） */
function stripComments(src) {
  let out = '';
  let inQuote = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') inQuote = !inQuote;
    if (c === '#' && !inQuote) {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += c;
  }
  return out;
}

/** 极简块语法解析：只关心 { }、; 与引号字面量，足够还原 nginx 的层级 */
function parseBlocks(src) {
  const root = { name: '(file)', directives: [], blocks: [] };
  const stack = [root];
  let buf = '';
  const push = () => {
    const d = buf.trim();
    if (d) stack[stack.length - 1].directives.push(d);
    buf = '';
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') {
      const name = buf.trim() || '(anonymous)';
      buf = '';
      const block = { name, directives: [], blocks: [] };
      stack[stack.length - 1].blocks.push(block);
      stack.push(block);
    } else if (c === '}' || c === ';') {
      push();
      if (c === '}') stack.pop();
    } else if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\') {
          buf += src[j];
          j++;
        }
        buf += src[j];
        j++;
      }
      buf += '"';
      i = j;
    } else {
      buf += c;
    }
  }
  return root;
}

/** 本层声明的 add_header 名（保持原样大小写，比较时再归一） */
function ownHeaders(block) {
  return block.directives.filter((d) => /^add_header\s+\S+/.test(d)).map((d) => d.split(/\s+/)[1]);
}

function findBlock(block, predicate) {
  if (predicate(block)) return block;
  for (const child of block.blocks) {
    const hit = findBlock(child, predicate);
    if (hit) return hit;
  }
  return null;
}

export function analyze(src) {
  const tree = parseBlocks(stripComments(src));
  const server = findBlock(tree, (b) => b.name === 'server') || tree;
  const required = ownHeaders(server);
  const locations = [];
  const walk = (block, inherited) => {
    const own = ownHeaders(block);
    // nginx 的规则：本层一旦声明了任何 add_header，就完全不继承上层
    const effective = own.length ? own : inherited;
    if (/^location(\s|$)/.test(block.name)) {
      locations.push({
        name: block.name.replace(/\s+/g, ' ').trim(),
        own,
        effective,
        missing: required.filter((h) => !effective.includes(h)),
      });
    }
    for (const child of block.blocks) walk(child, effective);
  };
  walk(server, required);
  return { required, locations };
}

function main() {
  let src;
  try {
    src = readFileSync(CONF, 'utf8');
  } catch (err) {
    console.error(`读不到 nginx 配置：${CONF}（${err.code || err.message}）`);
    process.exitCode = 1;
    return;
  }
  const { required, locations } = analyze(src);
  const csp = required.find((h) => h.toLowerCase() === 'content-security-policy');
  const problems = [];
  if (!csp) {
    problems.push('server 级没有声明 Content-Security-Policy，继承链的源头就是空的');
  }
  for (const loc of locations) {
    if (loc.missing.length) {
      problems.push(
        `[${loc.name}] 有效响应缺 ${loc.missing.length} 个头: ${loc.missing.join(', ')}`
      );
    }
  }
  if (AS_JSON) {
    console.log(JSON.stringify({ conf: CONF, required, locations, problems }, null, 2));
  } else {
    console.log(`nginx 配置：${CONF}`);
    console.log(`server 级安全头 ${required.length} 条：${required.join(' | ')}`);
    for (const loc of locations) {
      const mode = loc.own.length ? `自带 ${loc.own.length} 条 add_header（不继承）` : '继承父级';
      const tail = loc.missing.length ? `  ← 缺 ${loc.missing.join(', ')}` : '';
      console.log(`  - ${loc.name.padEnd(46)} ${mode}${tail}`);
    }
  }
  if (problems.length) {
    console.error('\n[FAIL] nginx add_header 不继承：以下路径会静默丢掉安全头');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      '\n修法：在该 location 内重复声明缺失的安全头（nginx 无 include 片段时只能这样），' +
        '并在改动后重跑 pnpm security:headers。'
    );
    process.exitCode = 1;
  } else if (!AS_JSON) {
    console.log(`\nOK：${locations.length} 个 location 的有效头集合都完整`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
