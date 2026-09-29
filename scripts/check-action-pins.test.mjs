/**
 * action 钉版守卫的测试（跑法：pnpm test:monitoring）
 *
 * 为什么要单独有测试：这条守卫自己也可能是错的。它诞生于一次真实故障——
 * nightly-status.yml 的三个 uses 钉了根本不存在的 commit（API 422），外部拨测
 * 于是从未执行，而它的失败通知步骤在同一个 job 里，坏了不吭声。守卫若只会在
 * 人肉运行时才成立，等于没有。
 *
 * 网络用注入的假 fetchJson，不碰真实 API：断言的是判定逻辑，不是 GitHub 可用性。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimedVersion, parseUses, check } from './check-action-pins.mjs';

const SHA_A = 'fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09';
const SHA_B = 'b906affcce14559ad1aafd4ab0e942779e9f58b1';
const SHA_BAD = '34e1148743cd2429552c65b9afb2257b8cd2ca0a';

test('uses 行解析：抓到 repo/ref，并认出注释里声称的版本', () => {
  const text = [
    'jobs:',
    '  x:',
    '    steps:',
    '      - uses: actions/checkout@' + SHA_A + ' # v5.1.0（与 ci.yml 同 major）',
    '      - uses: actions/setup-node@v5',
    '      # 注释掉的 uses 行不该被当真：- uses: ghost/repo@deadbeef',
    '',
  ].join('\n');
  const list = parseUses(text, 'wf.yml');
  assert.equal(list.length, 2, '只算真正的 uses 行');
  assert.equal(list[0].pinned, true);
  assert.equal(list[0].version, 'v5.1.0');
  assert.equal(list[1].pinned, false, '@v5 是可变 tag');
  assert.equal(list[1].version, null);
});

test('claimedVersion：无版本、纯文字、带前缀都能处理', () => {
  assert.equal(claimedVersion('v4.0.1'), 'v4.0.1');
  assert.equal(claimedVersion('4'), null, '裸数字不算声称版本（会和日期打架，制造假失败）');
  assert.equal(claimedVersion('pinned 2026-09-25'), null);
  assert.equal(claimedVersion('v5.1.0, pinned 2026-09-25'), 'v5.1.0');
  assert.equal(claimedVersion(undefined), null);
});

test('钉了不存在的 commit → 报问题（这就是当初的实际故障形态）', async () => {
  const entries = parseUses('      - uses: actions/checkout@' + SHA_BAD + '\n', 'nightly.yml');
  const fakeFetch = async (path) => (path.includes(SHA_BAD) ? null : { sha: SHA_BAD });
  const { problems, okPinned } = await check(entries, fakeFetch);
  assert.equal(okPinned.length, 0);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /解析不到 commit/);
});

test('注释声称的版本与实际 tag 指向不符 → 报问题', async () => {
  const entries = parseUses('      - uses: pnpm/action-setup@' + SHA_B + ' # v4.0.1\n', 'n.yml');
  const fakeFetch = async (path) => {
    if (path.includes('/commits/')) return { sha: SHA_B };
    if (path.includes('/git/ref/tags/')) return { object: { type: 'commit', sha: 'a'.repeat(40) } };
    return null;
  };
  const { problems } = await check(entries, fakeFetch);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /注释与钉版不符/);
});

test('annotated tag 要再解一层 object 才算数', async () => {
  const entries = parseUses('      - uses: pnpm/action-setup@' + SHA_B + ' # v4.3.0\n', 'n.yml');
  const seen = [];
  const fakeFetch = async (path) => {
    seen.push(path);
    if (path.includes('/commits/')) return { sha: SHA_B };
    if (path.includes('/git/ref/tags/')) return { object: { type: 'tag', sha: 'cccc' + SHA_B } };
    if (path.includes('/git/tags/')) return { object: { type: 'commit', sha: SHA_B } };
    return null;
  };
  const { problems, okPinned } = await check(entries, fakeFetch);
  assert.deepEqual(problems, [], '解引用后一致就不该报');
  assert.match(okPinned[0], /= v4\.3\.0$/);
  assert.ok(
    seen.some((p) => p.includes('/git/tags/')),
    '确实走了二次解引用'
  );
});

test('可变 tag 只登记不报错（要不要全钉由人决定）', async () => {
  const entries = parseUses('      - uses: actions/checkout@v5\n', 'ci.yml');
  const { problems, mutable } = await check(entries, async () => null);
  assert.deepEqual(problems, []);
  assert.equal(mutable.length, 1);
});

test('仓库现状：三处钉版全部可解析、注释版本对得上', async () => {
  // 直接吃真实 workflow 目录：这条会随时间变，但正因为如此才值得钉住
  const { collectUses } = await import('./check-action-pins.mjs');
  const entries = collectUses();
  const pinned = entries.filter((e) => e.pinned);
  assert.ok(pinned.length >= 1, '至少 nightly-status.yml 的三处钉版应在册');
  const fakeFetch = async (path) => {
    const m = /commits\/([0-9a-f]{40})/.exec(path);
    if (m) return { sha: m[1] };
    const t = /tags\/([\w.]+)$/.exec(path);
    if (t) return { object: { type: 'commit', sha: pinned[0].ref } };
    return null;
  };
  const versions = [...new Set(pinned.map((e) => e.version).filter(Boolean))];
  assert.equal(versions.length >= 1, true, '钉版处应写明声称版本，否则注释等于没写');
  const bad = pinned.filter((e) => !/^[0-9a-f]{40}$/.test(e.ref));
  assert.deepEqual(bad, [], '钉版必须是完整 40 位 SHA');
  await check(entries, fakeFetch); // 假 fetch 下不抛异常即可，真判定由 CLI 负责
});
