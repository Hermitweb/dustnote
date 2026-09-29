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

test('可变 tag：存在则只登记不报错；tag 与分支都查不到才报', async () => {
  const entries = parseUses('      - uses: actions/checkout@v5', 'ci.yml');
  // 存在（tag 命中）
  const ok = await check(entries, async () => ({ ref: 'refs/tags/v5' }));
  assert.deepEqual(ok.problems, [], '存在性通过就不该报错');
  assert.equal(ok.mutable.length, 1, '但仍要登记：不锁内容这件事得看得见');
  // 不存在（tag 与分支都查不到）——上游改名/删除就是这种失败，形态与钉假 SHA 一样
  const gone = await check(entries, async (p) => (p.includes('/git/ref/') ? null : null));
  assert.equal(gone.problems.length, 1);
  assert.match(gone.problems[0], /可变引用解析不到/);
  // 同一个 repo@ref 只问一次（否则 @v5 几十处会当场烧光未认证额度）
  let calls = 0;
  const counting = async () => {
    calls++;
    return { ref: 'refs/tags/v5' };
  };
  const many = parseUses(
    '      - uses: actions/checkout@v5' +
      String.fromCharCode(10) +
      '      - uses: actions/checkout@v5',
    'ci.yml'
  );
  assert.equal(many.length, 2);
  await check(many, counting);
  assert.equal(calls, 1, '两个相同引用应只查一次，实际查了 ' + calls + ' 次');
});

test('问不到（限流/5xx）既不判红也不假装通过', async () => {
  const entries = parseUses('      - uses: actions/checkout@v5', 'ci.yml');
  const r = await check(entries, async () => {
    throw new Error('HTTP 403');
  });
  assert.deepEqual(r.problems, [], '额度耗尽不是代码缺陷，不该判红');
  assert.deepEqual(r.unknown, ['actions/checkout@v5'], '但必须报出来，不能悄悄当成通过');
});

test('钉版查不动时也走 unknown，而不是把守卫自己跑挂', async () => {
  const entries = parseUses('      - uses: actions/checkout@' + SHA_A + ' # v5.1.0', 'n.yml');
  const r = await check(entries, async () => {
    throw new Error('HTTP 403');
  });
  assert.deepEqual(r.problems, []);
  assert.equal(r.unknown.length, 1);
  assert.match(r.unknown[0], /查询失败/);
});
