#!/usr/bin/env node
/**
 * action 引用可解析性守卫（起因：2026-09-29 外部拨测 workflow 从没跑起来过）
 *
 * 钉 SHA 是供应链姿势，但钉一个查无此 commit 的 SHA 比不钉更糟：它会静默失效。
 * nightly-status.yml 当初三个 uses 全钉了不存在的 40 位十六进制（API 422），而
 * schedule 只在默认分支跑，于是这条「外部视角告警」从写下到被发现之间一次都没执行过。
 * 更糟的是它连「我坏了」都报不出来——开 issue 的步骤在同一个 job 里，job 起不来
 * 就没有 issue。所以这类校验必须由每次 push 都跑的门禁来担，不能指望被检查者自证。
 *
 * 守三件事：
 *   1. 钉 SHA 的必须能解析（该 commit 存在），且注释里写了版本时 SHA 必须就是那个 tag；
 *   2. 可变引用（@v5 / @stable）也必须**存在**：上游把 tag 改名或删除，失败形态和钉了
 *      假 SHA 一模一样——job 在 Set up job 阶段就死掉。要不要锁内容仍是人的选择，不拦；
 *   3. 「问不到」（限流 / 5xx）单独报数，既不判红也不假装通过。把 CI 的红绿绑在第三方
 *      API 的可用性上，只会训练人去忽略这条门禁。
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

/** 从注释里抽出声称的版本，如 v5.1.0 / v4 */
export function claimedVersion(note) {
  if (!note) return null;
  // 只认带 v 前缀的写法：注释里常同时有日期（# v5.1.0, pinned 2026-09-25），
  // 允许裸数字就会把 2026 当成声称版本，去查一个不存在的 tag——自造假失败。
  const m = /\bv(\d+(?:\.\d+){0,2})\b/.exec(note);
  return m ? 'v' + m[1] : null;
}

export function parseUses(text, source) {
  const out = [];
  text.split(/\r?\n/).forEach((line, idx) => {
    const m = USES_RE.exec(line);
    if (!m) return;
    out.push({
      source,
      line: idx + 1,
      repo: m[1],
      ref: m[2],
      pinned: SHA_RE.test(m[2]),
      version: claimedVersion(m[3]),
    });
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

/**
 * 可变引用是否存在：先按 tag 查，再按分支查（rust-toolchain@stable 就是分支）。
 * 三态而非布尔：missing = 确实没有；unknown = 问不出来（限流 / 5xx）。
 * 把「我没查到」当成「它不存在」，会让一条额度告警伪装成代码缺陷。
 */
async function refExists(fetchJson, repo, ref) {
  const hit = (v) => !!v && !!v.ref;
  try {
    if (hit(await fetchJson('repos/' + repo + '/git/ref/tags/' + ref))) return 'exists';
    if (hit(await fetchJson('repos/' + repo + '/git/ref/heads/' + ref))) return 'exists';
    return 'missing';
  } catch {
    return 'unknown';
  }
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
  const unknown = [];
  const seenMutable = {};

  for (const e of entries) {
    if (!e.pinned) {
      mutable.push(e.source + ':' + e.line + ' ' + e.repo + '@' + e.ref);
      // 同一个 repo@ref 只问一次：workflow 里 @v5 出现几十次，逐个查会当场烧光
      // 未认证的 60 次/小时额度（第一版就是这么把守卫自己跑挂的）。
      const key = e.repo + '@' + e.ref;
      if (!(key in seenMutable)) seenMutable[key] = await refExists(fetchJson, e.repo, e.ref);
      const verdict = seenMutable[key];
      if (verdict === 'missing') {
        problems.push(
          '可变引用解析不到：' +
            e.source +
            ':' +
            e.line +
            ' ' +
            key +
            ' —— tag 与分支都查不到，用到它的 job 会在 Set up job 阶段就死掉'
        );
      } else if (verdict === 'unknown') {
        unknown.push(key);
      }
      continue;
    }

    let commit = null;
    let failed = false;
    try {
      commit = await fetchJson('repos/' + e.repo + '/commits/' + e.ref);
    } catch {
      failed = true;
    }
    if (failed) {
      unknown.push(e.repo + '@' + e.ref.slice(0, 10) + '(查询失败)');
      continue;
    }
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
      let at = null;
      try {
        at = await tagCommit(fetchJson, e.repo, e.version);
      } catch {
        at = 'ERR';
      }
      if (at === 'ERR') {
        unknown.push(e.repo + ':' + e.version + '(tag 查询失败)');
      } else if (!at) {
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
  return { problems, mutable, okPinned, unknown };
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
  console.log(
    'workflow 里的 uses：' +
      entries.length +
      ' 处（钉 SHA ' +
      pinnedCount +
      ' 处，可变引用去重后待查若干）'
  );
  for (const p of r.okPinned) console.log('  OK ' + p);
  const uniqMutable = new Set(r.mutable.map((m) => m.split(' ')[1])).size;
  console.log(
    '  可变引用：' + r.mutable.length + ' 处使用、' + uniqMutable + ' 个不同 repo@ref（存在性已验）'
  );
  if (r.unknown.length) console.log('  未能验证（限流/5xx）：' + r.unknown.join(', '));
  if (r.problems.length) {
    console.error('');
    console.error('[FAIL] action 引用校验失败：');
    for (const p of r.problems) console.error('  - ' + p);
    console.error('教训出处：nightly-status.yml 曾钉了三个不存在的 commit，外部拨测因此');
    console.error('从未执行，而它自己的报错步骤也在同一个 job 里，坏了不吭声。');
    process.exitCode = 1;
  } else {
    console.log('');
    console.log(
      'OK：钉住的 action 全部可解析、注释版本与实际 commit 一致，可变引用都存在' +
        (r.unknown.length ? '（' + r.unknown.length + ' 项因限流/5xx 未能验证）' : '')
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
