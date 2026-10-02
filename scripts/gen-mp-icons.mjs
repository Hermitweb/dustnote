#!/usr/bin/env node
/**
 * 小程序图标生成器（消灭界面 emoji 的前置件）
 *
 * 为什么小程序要单独生成：weapp 拿不到 React 组件，也没有可靠的 SVG 标签渲染。
 * 但 WXSS 支持 data-URI 的 `mask-image`——把图形当遮罩、颜色交给 background-color，
 * 于是"同一张图"能跟着主题变色，语义上等价于 web 的 currentColor。
 *
 * 图形源仍是 lucide（与 web 的 lucide-react、RN 的 lucide-react-native 同一批数据），
 * 名字表来自 shared/src/icons.ts：**三端同名同图**。
 *
 * 用法：
 *   node scripts/gen-mp-icons.mjs            # 生成 / 覆盖
 *   node scripts/gen-mp-icons.mjs --check    # 只校验（CI 用，漂移则 exit 1）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'miniprogram/src/styles/mp-icons.scss');
const ICONS_DIR = join(ROOT, 'node_modules/lucide/dist/esm/icons');

const { ICON_SOURCES } = await import(pathToFileURL(join(ROOT, 'shared/dist/icons.js')).href);

/**
 * lucide 每个图标模块默认导出 [tag, attrs][]。
 * 按需 import 名字表点到的那几十个，不去解析 1600 个文件——用官方导出的数据结构，
 * 比拿正则啃它的源码可靠得多。
 */
async function glyphNodes(file) {
  const mod = await import(pathToFileURL(join(ICONS_DIR, file + '.js')).href);
  const nodes = mod.default;
  if (!Array.isArray(nodes) || !Array.isArray(nodes[0])) {
    throw new Error('图形结构不认识：' + file);
  }
  return nodes;
}

function toSvg(nodes) {
  const inner = nodes
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${tag} ${a}/>`;
    })
    .join('');
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    inner +
    '</svg>'
  );
}

const BASE = [
  '/* 生成文件，请勿手改 —— 由 scripts/gen-mp-icons.mjs 从 lucide 图形 + shared/src/icons.ts 名字表生成。',
  ' * 想加图标：先在 shared/src/icons.ts 加一行，再跑 node scripts/gen-mp-icons.mjs；',
  ' * 只在这里加会让三端名字表漂移（pnpm ui:check 会报）。 */',
  '',
  '/*',
  ' * 遮罩式图标：图形当 mask、颜色走 background-color，因此能用 color 继承文字色，',
  ' * 语义上等价于 web/RN 的 currentColor。尺寸由组件的行内 style 给（weapp 里 em/百分比',
  ' * 在 mask 上表现不稳，宽高显式更可靠）。',
  ' */',
  '.mp-icon {',
  '  display: inline-block;',
  '  flex-shrink: 0;',
  '  background-color: currentColor;',
  '  /* 组件在盒内放一个不换行空格撑住 inline 盒子，字号归零让它不显形。',
  '     不能用 color: transparent —— 那会让 background-color: currentColor 一起透明，图形就没了。 */',
  '  font-size: 0;',
  '  line-height: 0;',
  '  -webkit-mask-repeat: no-repeat;',
  '  mask-repeat: no-repeat;',
  '  -webkit-mask-position: center;',
  '  mask-position: center;',
  '  -webkit-mask-size: contain;',
  '  mask-size: contain;',
  '}',
];

const lines = [...BASE];
for (const [name, file] of Object.entries(ICON_SOURCES)) {
  if (!existsSync(join(ICONS_DIR, file + '.js'))) {
    console.error(`✗ 名字表里的 ${name} 指向不存在的 lucide 图形：${file}.js`);
    process.exit(1);
  }
  const nodes = await glyphNodes(file);
  const uri = 'data:image/svg+xml,' + encodeURIComponent(toSvg(nodes));
  lines.push(
    '',
    `.mp-icon--${name} {`,
    `  -webkit-mask-image: url("${uri}");`,
    `  mask-image: url("${uri}");`,
    '}'
  );
}

const out = lines.join('\n') + '\n';
const check = process.argv.includes('--check');
let current = null;
try {
  current = readFileSync(OUT, 'utf8');
} catch {
  /* 首次生成 */
}
if (check) {
  if (current !== out) {
    console.error('✗ 小程序图标与名字表/lucide 图形已漂移，请运行：node scripts/gen-mp-icons.mjs');
    process.exit(1);
  }
  console.log(`✓ 小程序图标同源（${Object.keys(ICON_SOURCES).length} 个）`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, out);
  console.log(
    `✓ 已生成 ${OUT.replace(ROOT + '/', '')}（${Object.keys(ICON_SOURCES).length} 个图标，${(out.length / 1024).toFixed(1)} KB）`
  );
}
