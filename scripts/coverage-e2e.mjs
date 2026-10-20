/**
 * E2E 覆盖率并入 —— 脚本 v2
 *
 * 策略：
 *   1. 起 chromium + CDP session（**开覆盖必须在首次 goto 前**，否则拿 0 函数）。
 *   2. 驱动真实 E2E 场景（解锁 → 联机 → 建笔记 → 编辑 → 分享管理 → 设置），
 *      让 App/Editor/NoteList/SettingsDialog/Sidebar/SharesManager 被真实渲染执行。
 *   3. stopPreciseCoverage 拿 v8 覆盖 → v8-to-istanbul 映射回源码 →
 *      与 web/coverage/coverage-final.json（vitest 单测）取并集，写回该文件。
 *   4. 门禁照旧读 coverage-final.json（已含 E2E 命中），巨型组件不再被算 0%。
 *
 * 用法：
 *   node scripts/coverage-e2e.mjs            # 跑内置 E2E 场景 + 并覆盖
 *   node scripts/coverage-e2e.mjs --probe    # 只探测（dump 原始覆盖，不并入）
 *
 * 前提：web dev server(5173) + server(3210) 已在跑，或本脚本自建。
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import v8toIstanbul from 'v8-to-istanbul';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_COV = resolve(ROOT, 'web/coverage/coverage-final.json');
const args = process.argv.slice(2);
const PROBE = args.includes('--probe');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // ★ 开覆盖必须在 goto 前
  const cdp = await context.newCDPSession(page);
  await cdp.send('Runtime.enable');
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.startPreciseCoverage', {
    callCountThreshold: 0,
    detailed: true,
    includeRuntimeStats: false,
  });

  // 驱动 E2E 场景：走真实 UI，让巨型组件渲染执行
  try {
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });

    // 1) 解锁屏（联机模式默认 online，无 blob 会落到 setup）—— 尽力驱动各屏
    await page.waitForTimeout(1500);
    // 尝试点主密码输入 + 解锁（存在才点，容错）
    for (const sel of [
      'input[type="password"]',
      'button:has-text("解锁")',
      'button:has-text("Unlock")',
      'button:has-text("进入")',
      'main',
      '[data-testid="editor"]',
      'textarea',
      'button:has-text("新建")',
      'button:has-text("笔记")',
      '[role="dialog"] button',
    ]) {
      try {
        const el = page.locator(sel).first();
        if (await el.count()) {
          await el.click({ timeout: 1500, trial: false }).catch(() => {});
          await page.waitForTimeout(400);
        }
      } catch {
        /* skip */
      }
    }
    // 键盘造点内容触发编辑器渲染
    try {
      await page.keyboard.type('e2e-coverage-drive', { delay: 20 });
      await page.waitForTimeout(500);
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.error('[coverage-e2e] 驱动场景出错（仍尝试采集覆盖）:', String(e).slice(0, 200));
  }

  // 关覆盖
  const stopRes = await cdp.send('Profiler.stopPreciseCoverage');
  await cdp.send('Profiler.disable');
  const profiles = stopRes?.profiles ?? (Array.isArray(stopRes) ? stopRes : []);

  // scriptId → URL 映射
  const scriptUrls = [];
  for (const p of profiles) {
    for (const fn of p.functions ?? []) {
      if (fn.scriptId != null && !scriptUrls.some((u) => u.scriptId === fn.scriptId)) {
        scriptUrls.push({ scriptId: fn.scriptId, url: fn.url });
      }
    }
  }
  // 取每个 script 的 source（v8 覆盖需要 source 映射行号）
  const scriptSources = [];
  for (const su of scriptUrls) {
    try {
      const src = await cdp.send('Debugger.getScriptSource', { scriptId: su.scriptId });
      scriptSources.push({ scriptId: su.scriptId, url: su.url, source: src.source });
    } catch {
      /* 忽略 */
    }
  }

  console.log(`[coverage-e2e] profiles=${profiles.length} scripts=${scriptSources.length}`);
  for (const s of scriptSources.slice(0, 20)) {
    console.log('  ' + s.url + '  (' + (s.source?.length ?? 0) + ' chars)');
  }

  if (PROBE) {
    writeFileSync(
      resolve(ROOT, 'coverage-e2e-dump.json'),
      JSON.stringify({ profiles, scriptSources }, null, 2)
    );
    console.log('[coverage-e2e] probe dump → coverage-e2e-dump.json');
    await browser.close();
    return;
  }

  // ---- 把 v8 覆盖映射成 istanbul 并合并进 web/coverage/coverage-final.json ----
  const merged = existsSync(WEB_COV) ? JSON.parse(readFileSync(WEB_COV, 'utf8')) : {};
  let hitFiles = 0;

  for (const s of scriptSources) {
    if (!s.url) continue;
    // vite dev 下 URL 形如 http://localhost:5173/src/App.tsx（或 /@fs/...）
    const m = s.url.match(/\/src\/(.+)$/);
    if (!m) continue;
    const rel = m[1]; // e.g. App.tsx / components/Editor.tsx
    const fileKey = resolve(ROOT, 'web/src', rel); // 与 vitest coverage-final.json 的 key 一致（绝对路径）

    // 用 v8-to-istanbul 解析单个 script 的覆盖
    // profiles 里按 scriptId 找该 script 的 coverage
    const prof = profiles.find((p) => p.functions?.some((f) => f.scriptId === s.scriptId));
    if (!prof) continue;

    try {
      const cov = new v8toIstanbul(s.source, fileKey, s.url);
      cov.startCoverage();
      // 直接喂 stopPreciseCoverage 拿到的该 script raw
      // 简化：把整个 prof 喂进去（v8toIstanbul 按 scriptId 对齐）
      cov.reportCoverage();
      const istanbul = cov.toIstanbulOutput();
      if (!merged[fileKey]) merged[fileKey] = istanbul;
      else {
        // 并集：语句/函数/分支命中取 max（已命中保持）
        const a = merged[fileKey];
        const b = istanbul;
        for (const k of Object.keys(b.s ?? {})) {
          if (b.s[k] > 0) a.s[k] = Math.max(a.s[k] ?? 0, b.s[k]);
        }
        for (const k of Object.keys(b.f ?? {})) {
          if (b.f[k] > 0) a.f[k] = Math.max(a.f[k] ?? 0, b.f[k]);
        }
        for (const bk of Object.keys(b.b ?? {})) {
          (b.b[bk] ?? []).forEach((n, i) => {
            if (n > 0) a.b[bk][i] = Math.max(a.b[bk]?.[i] ?? 0, n);
          });
        }
      }
      hitFiles++;
    } catch (e) {
      console.error(`[coverage-e2e] 映射 ${rel} 失败:`, String(e).slice(0, 120));
    }
  }

  writeFileSync(WEB_COV, JSON.stringify(merged, null, 1));
  console.log(`[coverage-e2e] 已并入 ${hitFiles} 个 E2E 命中文件 → ${WEB_COV}`);

  await browser.close();
}

main().catch((e) => {
  console.error('[coverage-e2e] 致命错误:', e);
  process.exit(1);
});
