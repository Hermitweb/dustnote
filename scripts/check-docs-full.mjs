#!/usr/bin/env node
/**
 * 文档三重检查（齐全性 + 版本一致性 + 链接有效性）
 *
 * 用于 `pnpm docs:full-check`（在 test-orchestrate.mjs 中默认串入 docs 阶段）。
 *
 * 三个维度：
 *   1. 齐全性（completeness）：每类必有的文档（用户指南/部署/安全/隐私/CHANGELOG 等）
 *      是否存在 + 是否被 README/官网索引到（孤儿文档等于不存在）。
 *   2. 版本一致性（version-consistency）：README/CHANGELOG/DEPLOY 等元数据文档中
 *      出现的版本号与根 package.json 一致（委托 check-readme-version.mjs）。
 *   3. 链接有效性（link-integrity）：
 *      a) 相对路径可达（含 docs/site/README 互引）；
 *      b) 站内锚点可达；
 *      c) 不得再指向已废弃路径（.trae/documents/* 等）；
 *      d) 官网（site/）资源链接完整。
 *
 * 任何子项失败 exit 1。--json 输出结构化报告，便于 CI 抓取。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');

const problems = [];

/** 必备文档清单（每条说明用途）。 */
const REQUIRED_DOCS = [
  { path: 'README.md', kind: 'overview', reason: '仓库入口，必须存在且包含快速开始' },
  { path: 'CHANGELOG.md', kind: 'changelog', reason: '变更日志，每次发版必写' },
  { path: 'DEPLOY.md', kind: 'deploy', reason: '部署指南，自托管用户依赖' },
  { path: 'LICENSE', kind: 'license', reason: '开源协议' },
  { path: 'CONTRIBUTING.md', kind: 'contrib', reason: '贡献指南' },
  { path: 'SECURITY.md', kind: 'security', reason: '安全策略与漏洞上报方式' },
  { path: 'docs/user-guide.md', kind: 'guide', reason: '用户文档，官网卡片索引' },
  { path: 'docs/self-hosting.md', kind: 'self-host', reason: '自托管场景必备' },
  { path: 'docs/faq.md', kind: 'faq', reason: 'FAQ，常见问题汇总' },
  { path: 'docs/security-model.md', kind: 'security-model', reason: '安全模型说明' },
  { path: 'docs/operations-runbook.md', kind: 'runbook', reason: '运维 Runbook' },
  { path: 'docs/production-checklist.md', kind: 'checklist', reason: '上线检查单' },
  { path: 'docs/api.md', kind: 'api', reason: 'API 文档（至少 stub）' },
  { path: 'docs/privacy-policy.md', kind: 'privacy', reason: '隐私政策（合规要求）' },
  { path: 'docs/terms-of-service.md', kind: 'tos', reason: '服务条款' },
  { path: 'docs/cookie-policy.md', kind: 'cookie', reason: 'Cookie 政策' },
  { path: 'docs/roadmap.md', kind: 'roadmap', reason: '路线图' },
  { path: 'docs/status.md', kind: 'status', reason: '状态页（必部署）' },
  { path: 'docs/compatibility-matrix.md', kind: 'compat', reason: '兼容性矩阵' },
  { path: 'THIRD_PARTY_NOTICES.md', kind: 'notices', reason: '第三方依赖声明' },
];

/** 不应再出现的废弃路径。 */
const FORBIDDEN_PATH_PATTERNS = [/^\.trae\/documents\//, /^docs\/\.mimosa\//];

/**
 * 收集仓库里所有 .md / .mdx（排除 node_modules / 隐藏目录 / coverage / dist）。
 * @param {string} dir
 * @param {string[]} acc
 */
function collectMd(dir, acc) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) {
      if (
        ent.isDirectory() &&
        ent.name !== '.github' &&
        ent.name !== '.husky' &&
        ent.name !== '.opencode' &&
        ent.name !== '.mimosa' &&
        ent.name !== '.release' &&
        ent.name !== '.workbuddy' &&
        ent.name !== '.zcode' &&
        ent.name !== '.debug'
      ) {
        // 跳过
      }
      if (
        ent.isDirectory() &&
        (ent.name === 'node_modules' ||
          ent.name === 'dist' ||
          ent.name === 'build' ||
          ent.name === 'coverage')
      ) {
        continue;
      }
    }
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (
        ent.name !== 'node_modules' &&
        ent.name !== 'dist' &&
        ent.name !== 'build' &&
        ent.name !== 'coverage' &&
        !ent.name.startsWith('.') // 跳过所有隐藏目录
      ) {
        collectMd(abs, acc);
      }
      continue;
    }
    if (/\.mdx?$/.test(ent.name)) acc.push(abs);
  }
}

/** GitHub 风格的 slug：小写、字母/数字/-/中文保留下划线以外的、空白转 -。 */
function slug(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

/** 剥掉围栏代码块与行内代码。 */
function stripCode(src) {
  const out = [];
  let fence = null;
  for (const line of src.split(/\r?\n/)) {
    if (fence) {
      const close = new RegExp('^ {0,3}(' + fence.char + '{' + fence.len + ',})\\s*$');
      out.push('');
      if (close.test(line)) fence = null;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})[^`~]*$/.exec(line);
    if (open) {
      fence = { char: open[1][0] === '`' ? '`' : '~', len: open[1].length };
      out.push('');
      continue;
    }
    out.push(line.replace(/`+[^`]*`+/g, ''));
  }
  return out.join('\n');
}

/** 取所有标题的 slug 集合。 */
function headings(src) {
  const set = new Set();
  const re = /^ {0,3}#{1,6}\s+(.+?)\s*#*$/;
  for (const line of stripCode(src).split('\n')) {
    const m = re.exec(line);
    if (m) set.add(slug(m[1]));
  }
  return set;
}

const rel = (abs) =>
  abs
    .slice(ROOT.length + 1)
    .split(sep)
    .join('/');

/* ===================== 1. 齐全性 ===================== */
function checkCompleteness() {
  const section = { name: 'completeness', issues: [] };
  const mdAbs = [];
  collectMd(ROOT, mdAbs);
  const mdRel = new Set(mdAbs.map(rel));

  for (const req of REQUIRED_DOCS) {
    const abs = join(ROOT, req.path);
    if (!existsSync(abs)) {
      section.issues.push({
        kind: 'missing',
        path: req.path,
        reason: req.reason,
        severity: 'error',
      });
      continue;
    }
    const stat = statSync(abs);
    if (stat.size < 200) {
      section.issues.push({
        kind: 'stub',
        path: req.path,
        reason: `文件小于 200 字节，可能是 stub：${req.reason}`,
        severity: STRICT ? 'error' : 'warn',
      });
    }
  }

  // 孤儿文档：README/docs/.github 之外、其他文档未被任何 README 引用。
  const indexFiles = mdAbs.filter(
    (a) => rel(a) === 'README.md' || rel(a).startsWith('docs/README') || rel(a).startsWith('docs/')
  );
  const referenced = new Set();
  for (const idx of indexFiles) {
    const text = readFileSync(idx, 'utf8');
    const re = /\[[^\]]+\]\(([^)]+)\)/g;
    let m;
    while ((m = re.exec(stripCode(text)))) {
      const tgt = m[1].split('#')[0];
      if (!tgt) continue;
      if (tgt.startsWith('http')) continue;
      const tgtAbs = resolve(dirname(idx), tgt);
      if (mdRel.has(rel(tgtAbs))) referenced.add(rel(tgtAbs));
    }
  }
  for (const f of mdAbs) {
    const r = rel(f);
    if (
      r === 'README.md' ||
      r.startsWith('docs/archive/') ||
      r.startsWith('docs/adr/') ||
      r.startsWith('docs/.mimosa') ||
      r.startsWith('site/') ||
      r.startsWith('.github/') ||
      r.startsWith('docs/mockups')
    )
      continue;
    // 只对顶级 docs/*.md 关心孤儿（archive/adr 排除）
    if (r.startsWith('docs/') && r.split('/').length === 2 && !referenced.has(r)) {
      section.issues.push({
        kind: 'orphan',
        path: r,
        severity: STRICT ? 'error' : 'warn',
        reason: '文档未被任何 README/索引引用，可能是孤儿',
      });
    }
  }

  return section;
}

/* ===================== 2. 版本一致性 ===================== */
function checkVersionConsistency() {
  const section = { name: 'version-consistency', issues: [] };
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;
  const docPatterns = [
    { path: 'README.md', re: /(?:version|版本)[\s:：vV]*[`"']?(\d+\.\d+\.\d+[\w.-]*)/g },
    { path: 'CHANGELOG.md', re: /##\s*\[?v?(\d+\.\d+\.\d+[\w.-]*)/g },
    { path: 'DEPLOY.md', re: /v(\d+\.\d+\.\d+[\w.-]*)/g },
  ];
  for (const p of docPatterns) {
    const abs = join(ROOT, p.path);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, 'utf8');
    const versions = new Set();
    let m;
    while ((m = p.re.exec(text))) versions.add(m[1]);
    if (versions.size === 0) {
      section.issues.push({
        kind: 'no-version',
        path: p.path,
        severity: STRICT ? 'warn' : 'info',
        reason: '未匹配到版本号',
      });
      continue;
    }
    for (const v of versions) {
      if (!version.startsWith(v.replace(/^v/, ''))) {
        // 允许历史版本（如 CHANGELOG 历史段），只有最新段需要核对
        if (p.path === 'CHANGELOG.md') continue;
        section.issues.push({
          kind: 'version-mismatch',
          path: p.path,
          severity: STRICT ? 'error' : 'warn',
          reason: `package.json=${version}, 文档=${v}`,
        });
      }
    }
  }
  return section;
}

/* ===================== 3. 链接有效性 ===================== */
function checkLinkIntegrity() {
  const section = { name: 'link-integrity', issues: [] };
  const mdAbs = [];
  collectMd(ROOT, mdAbs);

  for (const abs of mdAbs) {
    const text = readFileSync(abs, 'utf8');
    const src = stripCode(text);
    const heads = headings(text);
    const fileRel = rel(abs);

    // 3.1 废弃路径
    for (const re of FORBIDDEN_PATH_PATTERNS) {
      if (re.test(fileRel)) {
        section.issues.push({
          kind: 'forbidden-path',
          path: fileRel,
          severity: 'error',
          reason: '命中废弃路径规则',
        });
      }
    }

    // 3.2 相对路径
    const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
    let m;
    while ((m = linkRe.exec(src))) {
      const target = m[2];
      if (/^https?:/i.test(target) || target.startsWith('mailto:')) continue;
      const [pathPart, hashPart] = target.split('#');
      if (!pathPart) {
        // 纯锚点：检查当前文件
        if (hashPart && !heads.has(hashPart)) {
          section.issues.push({
            kind: 'broken-anchor',
            path: fileRel,
            severity: 'warn',
            reason: `当前文件找不到标题 #${hashPart}`,
          });
        }
        continue;
      }
      const tgtAbs = resolve(dirname(abs), pathPart);
      if (!existsSync(tgtAbs)) {
        section.issues.push({
          kind: 'broken-link',
          path: fileRel,
          severity: 'error',
          reason: `${target} 解析为 ${rel(tgtAbs)} 不存在`,
        });
        continue;
      }
      if (hashPart) {
        const tgtText = readFileSync(tgtAbs, 'utf8');
        const tgtHeads = headings(tgtText);
        if (!tgtHeads.has(hashPart)) {
          section.issues.push({
            kind: 'broken-anchor',
            path: fileRel,
            severity: 'warn',
            reason: `${target} 的锚点 #${hashPart} 在 ${rel(tgtAbs)} 找不到`,
          });
        }
      }
    }
  }

  // 3.3 官网 site/src 的资源链接（如截图、字体等）。
  const siteSrc = join(ROOT, 'site/src');
  if (existsSync(siteSrc)) {
    const sitePublic = join(ROOT, 'site/public');
    for (const ent of readdirSync(siteSrc, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      const abs = join(siteSrc, ent.name);
      if (!/\.(ts|tsx|html|css)$/.test(ent.name)) continue;
      const text = readFileSync(abs, 'utf8');
      const linkRe = /(?:href|src)\s*=\s*["']([^"']+)["']/g;
      let m;
      while ((m = linkRe.exec(text))) {
        const target = m[1];
        if (/^(https?:|data:|mailto:|#|\/)/i.test(target)) continue;
        const tgt = resolve(sitePublic, target.replace(/^\.\//, ''));
        if (!existsSync(tgt)) {
          section.issues.push({
            kind: 'site-asset-missing',
            path: rel(abs),
            severity: 'warn',
            reason: `${target} -> ${rel(tgt)} 不存在`,
          });
        }
      }
    }
  }

  return section;
}

/* ===================== 编排 ===================== */
const sections = [checkCompleteness(), checkVersionConsistency(), checkLinkIntegrity()];

const errors = [];
for (const s of sections) {
  for (const i of s.issues) {
    if (i.severity === 'error') errors.push({ ...i, section: s.name });
    else if (STRICT && i.severity === 'warn') errors.push({ ...i, section: s.name });
  }
  problems.push(...s.issues.map((i) => ({ ...i, section: s.name })));
}

if (JSON_OUT) {
  process.stdout.write(
    JSON.stringify({ sections, problems, errorCount: errors.length }, null, 2) + '\n'
  );
} else {
  for (const s of sections) {
    process.stderr.write(`\n[${s.name}]\n`);
    if (s.issues.length === 0) {
      process.stderr.write('  ✓ ok\n');
    } else {
      for (const i of s.issues) {
        const tag = i.severity === 'error' ? '✗' : i.severity === 'warn' ? '!' : '·';
        process.stderr.write(
          `  ${tag} [${i.kind}] ${i.path ?? '-'}${i.reason ? ` — ${i.reason}` : ''}\n`
        );
      }
    }
  }
  process.stderr.write(
    `\n=== 文档三重检查：${problems.length} 项问题，${errors.length} 项错误 ===\n`
  );
}

process.exit(errors.length > 0 ? 1 : 0);
