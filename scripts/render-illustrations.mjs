#!/usr/bin/env node
/**
 * 由 shared/src/illustrations.ts 生成插画样张 —— 效果图不手画。
 *
 * 为什么要生成而不是手写 SVG：手画的 mock 与落地的几何是两份东西，
 * 一旦分叉，"看效果图批准"这个环节就变成了批准一份不存在的设计。
 * 这里直接吃同一份事实源，样张里看到的每一个 path 就是三端要渲染的那个。
 *
 * 用法：node scripts/render-illustrations.mjs   -> docs/mockups/illustrations-from-source.html
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { ILLUSTRATIONS, ILL_SIZES, ILL_STROKE, ILL_VIEW_BOX } = await import(
  pathToFileURL(join(ROOT, 'shared/dist/illustrations.js')).href
);

/** 与 web/src/components/Illustration.tsx 同一套映射（改一处要改两处，故在此注明） */
function node(n) {
  const stroke = n.c === 'accent' ? 'var(--ac)' : 'currentColor';
  const w = n.w ?? ILL_STROKE;
  const o = n.o ?? 1;
  const dash = n.dash ? ` stroke-dasharray="${n.dash}"` : '';
  if (n.k === 'p')
    return `<path d="${n.d}" stroke="${stroke}" stroke-opacity="${o}" stroke-width="${w}"${dash}/>`;
  if (n.k === 'l')
    return `<line x1="${n.x1}" y1="${n.y1}" x2="${n.x2}" y2="${n.y2}" stroke="${stroke}" stroke-opacity="${o}" stroke-width="${w}"${dash}/>`;
  if (n.k === 'r')
    return `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.rx ?? 0}" stroke="${stroke}" stroke-opacity="${o}" stroke-width="1.5"${dash}/>`;
  if (n.k === 'c') {
    if (n.f)
      return `<circle cx="${n.cx}" cy="${n.cy}" r="${n.r}" fill="${stroke}" fill-opacity="${o}"/>`;
    return `<circle cx="${n.cx}" cy="${n.cy}" r="${n.r}" stroke="${stroke}" stroke-opacity="${o}" stroke-width="${w}"${dash}/>`;
  }
  throw new Error('未知节点类型 ' + n.k);
}

const svg = (name, size, color) => {
  const d = ILL_SIZES[size];
  return `<svg viewBox="${ILL_VIEW_BOX}" width="${d.w}" height="${d.h}" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round" style="color:${color};display:block">${ILLUSTRATIONS[name].map(node).join('')}</svg>`;
};

const NAMES = Object.keys(ILLUSTRATIONS);
/**
 * 每张样张用哪个墨色 —— 必须与 web/src/components/StatePlate.tsx 的 ILL_INK 同口径：
 * info / guide 用中性墨（强调只由插画内部标了 c:accent 的那一处负责），
 * danger 整张染红。上一版这里给 first-use 传了强调色，样张就把整本书画成蓝的 ——
 * 那正是规则 2 要拦的事，而它只在"样张由真几何生成"之后才看得见。
 */
const ILL_INK = {
  'first-use': 'var(--muted)',
  'empty-scope': 'var(--muted)',
  'no-results': 'var(--muted)',
  plain: 'var(--text3)',
  error: 'var(--danger)',
};

function row(mode, size) {
  const cls = mode === 'dark' ? 'dark' : '';
  return (
    `<div class="grid g5 ${cls}">` +
    NAMES.map(
      (n) =>
        `<div class="cell"><div class="panel ${cls}">${svg(n, size, ILL_INK[n])}</div><div class="name">${n}</div></div>`
    ).join('') +
    '</div>'
  );
}

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>插画样张（由共享几何生成）</title>
<style>
:root{--ac:#3b82f6;--ac-text:#295bac;--muted:#475569;--text3:#717a88;--danger:#a01b1d;--card:#fff;--line:rgba(15,23,42,.09);--bg:#eef2f9}
.dark{--ac:#7dd3fc;--ac-text:#bbe8fd;--muted:#94a3b8;--text3:#b1bbcb;--danger:#fcd9d9;--card:#172554;--line:rgba(255,255,255,.10);--bg:#091128}
*{box-sizing:border-box}body{margin:0;background:#f4f6fb;color:#111827;font:14px/1.6 -apple-system,"Segoe UI","Noto Sans SC",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:36px 26px 64px}
h1{font-size:22px;margin:0 0 6px}h2{font-size:13px;letter-spacing:.07em;text-transform:uppercase;color:#6b7280;margin:34px 0 12px;padding-bottom:7px;border-bottom:1px solid #e5e7eb}
.lede{color:#4b5563;margin:0 0 8px;max-width:80ch}
.gen{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:#9ca3af;margin:0 0 22px}
.grid{display:grid;gap:14px}.g5{grid-template-columns:repeat(5,1fr)}
.cell{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 10px 9px;text-align:center}
.cell.dark{background:#0b1330;border-color:#1c2b57}
.panel{display:flex;align-items:center;justify-content:center;min-height:104px;border-radius:10px;background:var(--bg);border:1px solid var(--line)}
.name{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:#6b7280;margin-top:8px}
</style></head><body><div class="wrap">
<h1>插画样张 · 由共享几何生成</h1>
<p class="lede">这份文件不是手画的：它 import <code>shared/dist/illustrations.js</code>，
与 web 组件、小程序生成器、RN 组件吃的是同一份节点表。样张里看到的每个 path，就是三端要渲染的那个。</p>
<p class="gen">node scripts/render-illustrations.mjs &nbsp;·&nbsp; ${NAMES.length} 张 &nbsp;·&nbsp; viewBox ${ILL_VIEW_BOX} &nbsp;·&nbsp; stroke ${ILL_STROKE}</p>
<h2>plate 档 · ${ILL_SIZES.plate.w}×${ILL_SIZES.plate.h}</h2>
${row('light', 'plate')}
<h2>plate 档 · 深色</h2>
${row('dark', 'plate')}
<h2>card 档 · ${ILL_SIZES.card.w}×${ILL_SIZES.card.h}</h2>
${row('light', 'card')}
<h2>card 档 · 深色</h2>
${row('dark', 'card')}
</div></body></html>
`;
mkdirSync(join(ROOT, 'docs/mockups'), { recursive: true });
writeFileSync(join(ROOT, 'docs/mockups/illustrations-from-source.html'), html);
console.log(
  'OK  生成 docs/mockups/illustrations-from-source.html（' + NAMES.length + ' 张 × 2 档 × 2 模式）'
);
