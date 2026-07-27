/**
 * DustNote Android 图标生成器
 *
 * 生成各密度的 PNG 启动器图标（绿色渐变圆角矩形 + 白色对勾），
 * 与 web/favicon.svg、桌面端 icon 保持一致的视觉风格。
 *
 * 用法：node generate-icons.js
 * 输出：app/src/main/res/mipmap-{density}/ic_launcher.png 和 ic_launcher_round.png
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ========== PNG 编码器 ==========

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * 将 RGBA 像素数组编码为 PNG
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba - 每像素 4 字节 (R, G, B, A)
 * @returns {Buffer}
 */
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT: 每行前加 filter byte (0)
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    const srcStart = y * stride;
    rgba.subarray(srcStart, srcStart + stride).forEach((v, i) => {
      raw[y * (stride + 1) + 1 + i] = v;
    });
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ========== 图标渲染 ==========

/** 线性插值 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * 渲染 DustNote 图标
 * 绿色渐变圆角矩形背景 + 白色对勾
 * @param {number} size - 输出尺寸
 * @param {boolean} round - 是否圆形裁剪
 * @returns {Uint8Array} RGBA 像素
 */
function renderIcon(size, round = false) {
  const rgba = new Uint8Array(size * size * 4);
  // 在 512x512 逻辑坐标系中绘制，缩放到目标尺寸
  const S = 512;
  const scale = S / size;

  // 圆角半径（与 favicon rx=12/64 比例一致）
  const radius = S * (12 / 64);
  // 圆角矩形边界
  const rectX = S * (8 / 64);
  const rectY = S * (8 / 64);
  const rectW = S - 2 * rectX;
  const rectH = S - 2 * rectY;

  // 对勾路径（与 favicon 一致）：M22,32 L30,40 L42,24（64x64 坐标系）
  const cs = S / 64; // 坐标缩放
  const checkP1 = { x: 22 * cs, y: 32 * cs };
  const checkP2 = { x: 30 * cs, y: 40 * cs };
  const checkP3 = { x: 42 * cs, y: 24 * cs };
  const strokeWidth = 4 * cs;

  // 渐变色
  const gradStart = { r: 0x86, g: 0xef, b: 0xac }; // #86efac
  const gradEnd = { r: 0x22, g: 0xc5, b: 0x5e }; // #22c55e

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const lx = px * scale; // 逻辑 x
      const ly = py * scale; // 逻辑 y
      const idx = (py * size + px) * 4;

      // ---- 背景圆角矩形（或圆形）----
      let inBg = false;
      if (round) {
        // 圆形：以中心为圆心，半径 S/2
        const cx = S / 2;
        const cy = S / 2;
        const dx = lx - cx;
        const dy = ly - cy;
        if (dx * dx + dy * dy <= (S / 2) * (S / 2)) {
          inBg = true;
        }
      } else {
        // 圆角矩形
        const dx = Math.max(rectX - lx, 0, lx - (rectX + rectW));
        const dy = Math.max(rectY - ly, 0, ly - (rectY + rectH));
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= radius) {
          inBg = true;
        }
        // 边缘抗锯齿
        if (dist > radius && dist < radius + 1) {
          const alpha = Math.max(0, radius + 1 - dist);
          if (alpha > 0) {
            const t = Math.sqrt(lx * lx + ly * ly) / (Math.sqrt(2) * S);
            const r = lerp(gradStart.r, gradEnd.r, t);
            const g = lerp(gradStart.g, gradEnd.g, t);
            const b = lerp(gradStart.b, gradEnd.b, t);
            rgba[idx] = r;
            rgba[idx + 1] = g;
            rgba[idx + 2] = b;
            rgba[idx + 3] = Math.round(255 * alpha);
            continue;
          }
        }
      }

      if (inBg) {
        // 对角线渐变
        const t = (lx + ly) / (2 * S);
        rgba[idx] = lerp(gradStart.r, gradEnd.r, t);
        rgba[idx + 1] = lerp(gradStart.g, gradEnd.g, t);
        rgba[idx + 2] = lerp(gradStart.b, gradEnd.b, t);
        rgba[idx + 3] = 255;
      } else {
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 0;
      }
    }
  }

  // ---- 绘制白色对勾（线段距离场）----
  function distToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
  }

  const halfWidth = strokeWidth / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const lx = px * scale;
      const ly = py * scale;
      const idx = (py * size + px) * 4;

      if (rgba[idx + 3] === 0) continue; // 透明像素跳过

      const p = { x: lx, y: ly };
      const d1 = distToSegment(p, checkP1, checkP2);
      const d2 = distToSegment(p, checkP2, checkP3);
      const d = Math.min(d1, d2);

      if (d < halfWidth) {
        // 实心白色
        rgba[idx] = 255;
        rgba[idx + 1] = 255;
        rgba[idx + 2] = 255;
        rgba[idx + 3] = 255;
      } else if (d < halfWidth + 1) {
        // 抗锯齿边缘
        const alpha = Math.max(0, halfWidth + 1 - d);
        const bgR = rgba[idx];
        const bgG = rgba[idx + 1];
        const bgB = rgba[idx + 2];
        rgba[idx] = lerp(bgR, 255, alpha);
        rgba[idx + 1] = lerp(bgG, 255, alpha);
        rgba[idx + 2] = lerp(bgB, 255, alpha);
      }
    }
  }

  return rgba;
}

// ========== 主逻辑 ==========

const RES_DIR = path.join(__dirname, 'app', 'src', 'main', 'res');

const SIZES = [
  { dir: 'mipmap-mdpi', size: 48 },
  { dir: 'mipmap-hdpi', size: 72 },
  { dir: 'mipmap-xhdpi', size: 96 },
  { dir: 'mipmap-xxhdpi', size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
];

console.log('Generating DustNote Android launcher icons...');

for (const { dir, size } of SIZES) {
  const outDir = path.join(RES_DIR, dir);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // ic_launcher.png（圆角矩形）
  const square = renderIcon(size, false);
  const squarePng = encodePNG(size, size, square);
  fs.writeFileSync(path.join(outDir, 'ic_launcher.png'), squarePng);
  console.log(`  ${dir}/ic_launcher.png  (${size}x${size}, ${squarePng.length} bytes)`);

  // ic_launcher_round.png（圆形）
  const round = renderIcon(size, true);
  const roundPng = encodePNG(size, size, round);
  fs.writeFileSync(path.join(outDir, 'ic_launcher_round.png'), roundPng);
  console.log(`  ${dir}/ic_launcher_round.png (${size}x${size}, ${roundPng.length} bytes)`);
}

console.log('\nDone! All launcher icons generated.');
