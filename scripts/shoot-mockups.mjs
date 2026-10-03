// 渲染设计效果图：node scripts/shoot-mockups.mjs -> docs/mockups/out/*.png
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync('docs/mockups/out', { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
await p.goto(pathToFileURL(path.join(ROOT, 'docs/mockups/illustration-language.html')).href);
await p.waitForTimeout(400);
const shots = [
  ['01-rules', 'h2:nth-of-type(1)'],
  ['02-canvas', 'h2:nth-of-type(2)'],
  ['03-set', 'h2:nth-of-type(3)'],
  ['04-screens', 'h2:nth-of-type(4)'],
];
for (const [name, sel] of shots) {
  const h = await p.locator(sel).elementHandle();
  if (!h) {
    console.log('缺锚点 ' + name);
    continue;
  }
  // 从标题往下取到下一个 h2 之前：用 boundingBox 差值裁一段
  const box = await h.boundingBox();
  const next = await p.evaluate((y) => {
    const hs = [...document.querySelectorAll('h2')].map(
      (e) => e.getBoundingClientRect().top + window.scrollY
    );
    const after = hs.find((t) => t > y + 10);
    return after ?? document.body.scrollHeight;
  }, box.y);
  await p
    .screenshot({
      path: 'docs/mockups/out/' + name + '.png',
      clip: {
        x: 0,
        y: Math.max(0, box.y - 12 + (await p.evaluate(() => window.scrollY)), 0),
        width: 1200,
        height: Math.min(1600, next - box.y + 40),
      },
      fullPage: true,
    })
    .catch(async () => {
      await p.screenshot({ path: 'docs/mockups/out/' + name + '.png', fullPage: false });
    });
  console.log('shot ' + name);
}
await p.screenshot({ path: 'docs/mockups/out/00-full.png', fullPage: true });
console.log('full page 已存');
await b.close();
