/**
 * 图标资源生成器（构建期一次性工具，产物已入库，日常构建不需要跑）
 *
 *   node mobile/scripts/gen-icons.mjs
 *
 * 形状取自 shared/src/icons.ts（三端单一来源，需先 `pnpm --filter @dustnote/shared build`）。
 * 安卓侧用 `<Image source={png} tintColor={color} />` 着色（等价 web 的
 * currentColor）：RN 不支持内联 SVG，且 tintColor 只对位图生效，
 * 因此这里把每 图标栅格化成白色 PNG，颜色交给运行时 tint。
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
const outDir = join(here, '../src/assets/icons');
mkdirSync(outDir, { recursive: true });

const { ICON_PATHS } = await import(new URL('../../shared/dist/icons.js', import.meta.url).href);

const SIZE = 72; // 24 逻辑 px 的 3 倍，缩放到 14-26px 仍锐利

let n = 0;
for (const [name, def] of Object.entries(ICON_PATHS)) {
  const paint = def.fill
    ? 'fill="#fff" stroke="none"'
    : 'fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
  // 注意：def.path 是 d 属性值，必须包在 <path d="…"> 里——直接当元素内容
  // 会产出无图形元素的 SVG，sharp 不报错但渲染成全透明 PNG
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${def.path}" ${paint}/></svg>`;
  const png = await sharp(Buffer.from(svg))
    .resize(SIZE, SIZE)
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(outDir, `${name}.png`), png);
  n++;
}
console.log(`生成 ${n} 个图标 → ${outDir}`);
