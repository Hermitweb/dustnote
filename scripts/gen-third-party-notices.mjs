// 审计 DOC-007：生成第三方开源许可声明 THIRD_PARTY_NOTICES.md。
// 直接扫描已安装 node_modules 的包元数据（name/version/license），按许可类型聚合，
// 供分发时履行 MIT/OFL/BSD/Apache 等上游版权与许可保留义务，并为应用商店
// "依赖/数据与安全"声明提供来源。用法：node scripts/gen-third-party-notices.mjs
// 纯只读扫描 + 写一个文档文件，无副作用。
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** 递归收集 node_modules 下的包（含 scoped 与嵌套 transitive） */
function collect(dirs, out, seen) {
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.startsWith('.')) continue;
      const full = join(dir, e);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      if (e.startsWith('@')) {
        collect([full], out, seen); // scoped: 下一层是真实包
        continue;
      }
      const pj = join(full, 'package.json');
      if (existsSync(pj)) {
        const j = readJson(pj);
        if (j && j.name) {
          const key = j.name;
          if (!seen.has(key)) {
            seen.add(key);
            let license = j.license || (j.licenses && JSON.stringify(j.licenses));
            if (!license && j.readme) {
              const m = /License:\s*([A-Za-z0-9.\-]+)/i.exec(j.readme);
              if (m) license = m[1];
            }
            out.push({ name: j.name, version: j.version || '?', license: license || 'UNKNOWN' });
          }
        }
      }
      // 进入嵌套 node_modules（transitive）
      const nested = join(full, 'node_modules');
      if (existsSync(nested)) collect([nested], out, seen);
    }
  }
}

const pkgs = [];
const seen = new Set();
// 根 + 各 workspace 包的 node_modules
const scanDirs = [nm];
for (const ws of ['shared', 'client-core', 'server', 'web', 'desktop', 'mobile', 'miniprogram']) {
  scanDirs.push(join(root, ws, 'node_modules'));
}
collect(scanDirs, pkgs, seen);
pkgs.sort((a, b) => a.name.localeCompare(b.name));

// 按 license 聚合计数
const byLicense = {};
for (const p of pkgs) byLicense[p.license] = (byLicense[p.license] || 0) + 1;

const copyleft = pkgs.filter((p) => /GPL|AGPL|LGPL|MPL|CDDL/i.test(p.license));

const lines = [];
lines.push('# 第三方开源许可声明 (Third-Party Notices)');
lines.push('');
lines.push('> 本文件由 `node scripts/gen-third-party-notices.mjs` 自动生成，请勿手工编辑。');
lines.push('> 分发 DustNote（含桌面/移动/小程序打包）时，须随附本文件以履行上游');
lines.push('> MIT / BSD / Apache-2.0 / OFL 等许可的版权与声明保留义务。');
lines.push('');
lines.push(`- 已扫描包总数（去重）：${pkgs.length}`);
lines.push(`- 生成时间：${new Date().toISOString()}`);
lines.push('');
lines.push('## 许可类型分布');
lines.push('');
lines.push('| 许可证 | 包数 |');
lines.push('| --- | --- |');
for (const [lic, n] of Object.entries(byLicense).sort((a, b) => b[1] - a[1])) {
  lines.push(`| ${lic} | ${n} |`);
}
lines.push('');
lines.push('## Copyleft 组件（需关注）');
lines.push('');
if (copyleft.length === 0) {
  lines.push('未发现强 copyleft（GPL/AGPL）组件。部分双许可组件（如 node-forge、jszip）');
  lines.push('含 GPL 备选条款，本项目使用其 permissive 分支，特此说明。');
} else {
  lines.push('| 包 | 版本 | 许可证 |');
  lines.push('| --- | --- | --- |');
  for (const p of copyleft) lines.push(`| ${p.name} | ${p.version} | ${p.license} |`);
}
lines.push('');
lines.push('## 字体（SIL Open Font License）');
lines.push('');
lines.push('UI 使用的 Manrope、Noto Sans SC、JetBrains Mono 均为 SIL OFL 1.1，');
lines.push('随包分发须保留字体版权与 OFL 授权文本。');
lines.push('');
lines.push('## 完整清单');
lines.push('');
lines.push('| 包 | 版本 | 许可证 |');
lines.push('| --- | --- | --- |');
for (const p of pkgs) lines.push(`| ${p.name} | ${p.version} | ${p.license} |`);
lines.push('');

writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'), 'utf8');
console.log(
  `✅ 已生成 THIRD_PARTY_NOTICES.md（${pkgs.length} 个去重包，${Object.keys(byLicense).length} 种许可）`
);
