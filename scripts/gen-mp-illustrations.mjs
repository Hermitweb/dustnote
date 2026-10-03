#!/usr/bin/env node
/**
 * 小程序插画生成器
 *
 * 为什么是"两层遮罩"而不是一张：weapp 拿不到 React SVG 组件，能变色的路子只有
 * mask-image（图形当遮罩、颜色走 background-color）。但遮罩是单色的 ——
 * 一张图里"中性墨的主体 + 唯一一处强调色"就没法表达，而那正是插画语言的第 2 条规则。
 * 所以每张插画发两个类：
 *   .mp-illust--<name>          只含 ink 节点，吃 currentColor
 *   .mp-illust--<name>-accent   只含 accent 节点，吃 var(--primary)
 * 组件把两层绝对定位叠在同一个盒子里。
 *
 * 几何仍来自 shared/src/illustrations.ts：与 web / RN 同一份节点表，三端同名同图。
 *
 * 用法：node scripts/gen-mp-illustrations.mjs [--check]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'miniprogram/src/styles/mp-illustrations.scss');

const { ILLUSTRATIONS, ILL_STROKE, ILL_VIEW_BOX } = await import(
  pathToFileURL(join(ROOT, 'shared/dist/illustrations.js')).href
);

/** 节点 -> SVG 元素串。layer 决定这张图里留哪一类着色 */
function el(n) {
  const w = n.w ?? ILL_STROKE;
  const o = n.o ?? 1;
  const dash = n.dash ? ` stroke-dasharray="${n.dash}"` : '';
  switch (n.k) {
    case 'p':
      return `<path d="${n.d}" stroke="#000" stroke-opacity="${o}" stroke-width="${w}"${dash}/>`;
    case 'l':
      return `<line x1="${n.x1}" y1="${n.y1}" x2="${n.x2}" y2="${n.y2}" stroke="#000" stroke-opacity="${o}" stroke-width="${w}"${dash}/>`;
    case 'r':
      return `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.rx ?? 0}" stroke="#000" stroke-opacity="${o}" stroke-width="${w}"${dash}/>`;
    case 'c':
      return n.f
        ? `<circle cx="${n.cx}" cy="${n.cy}" r="${n.r}" fill="#000" fill-opacity="${o}"/>`
        : `<circle cx="${n.cx}" cy="${n.cy}" r="${n.r}" stroke="#000" stroke-opacity="${o}" stroke-width="${w}"${dash}/>`;
    default:
      throw new Error('未知节点类型 ' + n.k);
  }
}

function uri(nodes) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ILL_VIEW_BOX}" fill="none" ` +
    `stroke-linecap="round" stroke-linejoin="round">` +
    nodes.map(el).join('') +
    '</svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

const lines = [
  '/* 生成文件，请勿手改 —— 由 scripts/gen-mp-illustrations.mjs 从 shared/src/illustrations.ts 生成。',
  ' * 想改几何改那张节点表；只在这里改会让三端漂移（pnpm ui:check 会报）。 */',
  '',
  '/* 一张插画 = 两层遮罩叠在同一个盒子里：ink 层跟随文字色，accent 层用强调色。',
  '   单色 mask 表达不了"整张中性、只点一处强调"，所以只能分两层。 */',
  '.mp-illust {',
  '  position: relative;',
  '  display: block;',
  '  flex-shrink: 0;',
  '}',
  '.mp-illust-layer {',
  '  position: absolute;',
  '  inset: 0;',
  '  background-color: currentColor;',
  '  -webkit-mask-repeat: no-repeat;',
  '  mask-repeat: no-repeat;',
  '  -webkit-mask-position: center;',
  '  mask-position: center;',
  '  -webkit-mask-size: contain;',
  '  mask-size: contain;',
  '}',
  '.mp-illust-layer--accent {',
  '  background-color: var(--primary);',
  '}',
];

for (const [name, nodes] of Object.entries(ILLUSTRATIONS)) {
  const ink = nodes.filter((n) => n.c !== 'accent');
  const accent = nodes.filter((n) => n.c === 'accent');
  lines.push(
    '',
    `.mp-illust--${name} .mp-illust-layer--ink {`,
    `  -webkit-mask-image: url("${uri(ink)}");`,
    `  mask-image: url("${uri(ink)}");`,
    '}'
  );
  if (accent.length) {
    lines.push(
      '',
      `.mp-illust--${name} .mp-illust-layer--accent {`,
      `  -webkit-mask-image: url("${uri(accent)}");`,
      `  mask-image: url("${uri(accent)}");`,
      '}'
    );
  }
}

const out = lines.join('\n') + '\n';
if (process.argv.includes('--check')) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
  if (cur !== out) {
    console.error('✗ 小程序插画与节点表已漂移，请运行：node scripts/gen-mp-illustrations.mjs');
    process.exit(1);
  }
  console.log(`✓ 小程序插画同源（${Object.keys(ILLUSTRATIONS).length} 张）`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, out);
  console.log(
    `✓ 已生成 miniprogram/src/styles/mp-illustrations.scss（${Object.keys(ILLUSTRATIONS).length} 张，${(out.length / 1024).toFixed(1)} KB）`
  );
}
