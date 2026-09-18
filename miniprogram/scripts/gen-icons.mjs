/**
 * 图标资源生成器（构建期一次性工具，产物已入库，日常构建不需要跑）
 *
 *   node miniprogram/scripts/gen-icons.mjs
 *
 * 为什么要生成：小程序 `image` 组件对 SVG 只稳定支持网络地址，base64 SVG
 * 在部分平台不渲染；而 WXSS 又不允许 background-image 用本地文件路径。
 * 因此走「PNG → base64 内联 WXSS + -webkit-mask + background-color」：
 * 遮罩用图片形状、颜色由 CSS 决定（等价图标字体），随主题/文案色自动变色，
 * 且 PNG 遮罩在任何 WebView 渲染模式下都可靠（不依赖 SVG 解码）。
 *
 * 依赖 sharp 仅用于本脚本（临时安装，不写入 package.json）：
 *   npm i sharp --prefix <tmp> --no-save
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_PATH || 'sharp');

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, '../src/styles/icons.wxss');
mkdirSync(dirname(outFile), { recursive: true });

const { ICON_PATHS: PATHS } = await import(
  new URL('../../shared/dist/icons.js', import.meta.url).href
);

const SIZE = 72; // 24 逻辑 px 的 3 倍：正列图下缩到 14-22px 仍锐利

const parts = [
  '/* 由 miniprogram/scripts/gen-icons.mjs 生成，请勿手改 */',
  '.icon {',
  '  display: inline-block;',
  '  background-color: currentColor;',
  '  -webkit-mask-repeat: no-repeat;',
  '  mask-repeat: no-repeat;',
  '  -webkit-mask-position: center;',
  '  mask-position: center;',
  '  -webkit-mask-size: contain;',
  '  mask-size: contain;',
  '  vertical-align: -0.18em;',
  '  flex-shrink: 0;',
  '}',
];

for (const [name, def] of Object.entries(PATHS)) {
  const paint = def.fill
    ? 'fill="#fff" stroke="none"'
    : 'fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
  // def.path 是 d 属性值，必须包在 <path d="…"> 里（否则 sharp 静默产出全透明图）
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${def.path}" ${paint}/></svg>`;
  const png = await sharp(Buffer.from(svg))
    .resize(SIZE, SIZE)
    .png({ compressionLevel: 9 })
    .toBuffer();
  parts.push(
    `.icon-${name}{-webkit-mask-image:url("data:image/png;base64,${png.toString('base64')}");mask-image:url("data:image/png;base64,${png.toString('base64')}")}`
  );
}

writeFileSync(outFile, parts.join('\n') + '\n', 'utf8');
const bytes = Buffer.byteLength(parts.join('\n'));
console.log(
  `生成 ${Object.keys(PATHS).length} 个图标 → ${outFile}（${(bytes / 1024).toFixed(1)} KB WXSS）`
);
