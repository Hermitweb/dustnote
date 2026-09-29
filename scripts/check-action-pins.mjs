#!/usr/bin/env node
/**
 * action 钉版可解析性守卫（起因：2026-09-29 外部拨测 workflow 从没跑起来过）
 *
 * 钉 SHA 是供应链姿势，但钉一个查无此 commit 的 SHA 比不钉更糟：它会静默失效。
 * nightly-status.yml 当初三个 uses 全钉了不存在的 40 位十六进制（API 422），而
 * schedule 只在默认分支跑，于是这条「外部视角告警」从写下到被发现之间一次都没执行过。
 * 更糟的是它连「我坏了」都报不出来——开 issue 的步骤在同一个 job 里，job 起不来
 * 就没有 issue。所以这类校验必须由每次 push 都跑的门禁来担，不能指望被检查者自证。
 *
 * 三件事：
 *   1. 钉 SHA 的必须能解析（该 commit 存在）；
 *   2. 注释里写了版本（# v5.0.2）的，SHA 必须真是那个 tag 指向的提交；
 *   3. 仍用可变 tag（@v5）的列出来，数量可见——要不要全钉由人决定，不默认拦。
 *
 * 用法：node scripts/check-action-pins.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WF_DIR = join(ROOT, '.github/workflows');
const SHA_RE = /^[0-9a-f]{40}$/;
const OBJ_COMMIT = 'commit';
// uses: owner/repo@ref  [# 任意注释]
const USES_RE = /^\s*-?\s*uses:\s*([\w.-]+\/[\w.-]+)@([^\s#]+)\s*(?:#\s*(.*))?$/;

/** 从注释里抽出声称的版本，如 v5.0.2 / v4 */
export function claimedVersion(note) {
  if (!note) return null;
  // 只认带 v 前缀的写法：注释里常同时有日期（# v5.1.0, pinned 2026-09-25），
  // 若允许裸数字就会把 2026 当成声称版本，去查一个不存在的 tag——假失败。
  const m = /\bv(\d+(?:\.\d+){0,2})\b/.exec(note);
  return m ? 'v' + m[1] : null;
}

export function parseUses(text, source) {
  const out = [];
  text.split(/\r?\n/).forEach((line, idx) => {
    const m = USES_RE.exec(line);
    if (!m) return;
    const repo = m[1];
    const ref = m[2];
    const version = claimedVersion(m[3]);
    out.push({ source, line: idx + 1, repo, ref, pinned: SHA_RE.test(ref), version });
  });
  return out;
}

export function collectUses(dir) {
  const d = dir || WF_DIR;
  return readdirSync(d)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .flatMap((f) => parseUses(readFileSync(join(d, f), 'utf8'), f));
}

/** 取 tag 真正指向的 commit：annotated tag 还要再解一层 object */
async function tagCommit(fetchJson, repo, tag) {
  const ref = await fetchJson('repos/' + repo + '/git/ref/tags/' + tag);
  if (!ref || !ref.object) return null;
  if (ref.object.type === OBJ_COMMIT) return ref.object.sha;
  const obj = await fetchJson('repos/' + repo + '/git/tags/' + ref.object.sha);
  return obj && obj.object ? obj.object.sha : null;
}

export async function check(entries, fetchJson) {
  const problems = [];
  const mutable = [];
  const okPinned = [];
  for (const e of entries) {
    if (!e.pinned) {
      mutable.push(e.source + ':' + e.line + ' ' + e.repo + '@' + e.ref);
      continue;
    }
    const commit = await fetchJson('repos/' + e.repo + '/commits/' + e.ref);
    if (!commit || !commit.sha) {
      problems.push(
        '解析不到 commit：' +
          e.source +
          ':' +
          e.line +
          ' ' +
          e.repo +
          '@' +
          e.ref.slice(0, 10) +
          '... 钉了个不存在的 SHA，job 会直接起不来，而且报不出错'
      );
      continue;
    }
    let claimed = '';
    if (e.version) {
      const at = await tagCommit(fetchJson, e.repo, e.version);
      if (!at) {
        problems.push(e.source + ':' + e.line + ' 注释声称 ' + e.version + '，但查不到该 tag');
      } else if (at !== commit.sha) {
        problems.push(
          '注释与钉版不符：' +
            e.source +
            ':' +
            e.line +
            ' 声称 ' +
            e.version +
            ' 指向 ' +
            at.slice(0, 10) +
            '... 实际钉的是 ' +
            commit.sha.slice(0, 10) +
            '...'
        );
      } else {
        claimed = ' = ' + e.version;
      }
    }
    okPinned.push(e.repo + '@' + commit.sha.slice(0, 10) + claimed);
  }
  return { problems, mutable, okPinned };
}

async function defaultFetch(path) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  const res = await fetch('https://api.github.com/' + path, { headers });
  if (res.status === 404 || res.status === 422) return null;
  if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status);
  return res.json();
}

async function main() {
  const entries = collectUses();
  const pinnedCount = entries.filter((e) => e.pinned).length;
  const r = await check(entries, defaultFetch);
  console.log('workflow 里的 uses：' + entries.length + ' 处（钉 SHA ' + pinnedCount + ' 处）');
  for (const p of r.okPinned) console.log('  OK ' + p);
  for (const m of r.mutable) console.log('  可变 tag ' + m);
  if (r.problems.length) {
    console.error('');
    console.error('[FAIL] action 钉版校验失败：');
    for (const p of r.problems) console.error('  - ' + p);
    console.error('教训出处：nightly-status.yml 曾钉了三个不存在的 commit，外部拨测因此');
    console.error('从未执行，而它自己的报错步骤也在同一个 job 里，坏了不吭声。');
    process.exitCode = 1;
  } else {
    console.log('');
    console.log('OK：钉住的 action 全部可解析，注释版本与实际 commit 一致');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
