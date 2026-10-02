/**
 * UI 门禁自身的测试（跑法：pnpm test:monitoring，已进 CI）
 *
 * 为什么必须给门禁写测试：这次的教训之一就是"验收工具自己坏了三个缺陷，
 * 却从没被验收过"。一个不会红的检查等于没有检查，所以这里逐条喂违例，
 * 确认每条规则真的抓得住；再确认干净样本不误报。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanClassDiscipline, scanWiring, OUTLINE_NONE_ALLOWLIST } from './check-ui-scale.mjs';

const ids = (list) => list.map((f) => f.rule).sort();

test('越界尺度类名逐条抓得住', () => {
  const cases = [
    ['<div className="fixed z-[60]" />', 'z-arbitrary'],
    ['<span className="text-[11px]" />', 'text-arbitrary'],
    ['<div className="rounded-[3px]" />', 'radius-arbitrary'],
    ['<div className="p-[13px]" />', 'space-arbitrary'],
    ['<div className="gap-x-[7px]" />', 'space-arbitrary'],
    ['<button className="transition-colors duration-150" />', 'duration-numeric'],
    ['<button className="transition-all" />', 'transition-all'],
    ['<input className="focus:outline-none" />', 'outline-none'],
  ];
  for (const [src, want] of cases) {
    const got = scanClassDiscipline('web/src/X.tsx', src);
    assert.ok(got.length >= 1, '应当抓到：' + src);
    assert.ok(ids(got).includes(want), src + ' 应报 ' + want + '，实际 ' + ids(got));
  }
});

test('合规写法不误报', () => {
  const clean = [
    '<div className="fixed inset-0 z-confirm" />',
    '<span className="text-2xs text-surface-muted" />',
    '<div className="rounded-xl p-3 gap-2" />',
    '<button className="transition-colors duration-fast" />',
    '<button className="transition-[border-color,box-shadow]" />',
  ].join('\n');
  assert.deepEqual(scanClassDiscipline('web/src/Ok.tsx', clean), []);
});

test('outline-none 白名单要求点名文件（防止变成通用逃避口）', () => {
  assert.ok(OUTLINE_NONE_ALLOWLIST.length > 0, '白名单不该空掉');
  for (const a of OUTLINE_NONE_ALLOWLIST) {
    assert.ok(a.file && a.reason, '白名单每一项都要有 file 与 reason：' + JSON.stringify(a));
    assert.ok(a.reason.length >= 8, '理由不能是占位：' + a.file);
  }
  // 白名单内的文件放行、之外的同样写法必须报
  const f = OUTLINE_NONE_ALLOWLIST[0].file;
  assert.deepEqual(scanClassDiscipline(f, '<div className="outline-none" />'), []);
  assert.equal(
    scanClassDiscipline('web/src/Other.tsx', '<div className="outline-none" />').length,
    1
  );
});

const goodExtras = () => ({
  fontSize: { xs: ['var(--mn-text-xs)'] },
  spacing: { 3: 'calc(.75rem * var(--mn-density, 1))' },
  zIndex: { confirm: '60' },
  transitionDuration: { DEFAULT: 'var(--mn-duration-med, 180ms)' },
  transitionTimingFunction: { DEFAULT: 'var(--mn-ease, cubic-bezier(.2,0,0,1))' },
});
const goodTokens = [
  ':root { --mn-density: 1; --mn-text-2xs: calc(11px * var(--mn-density));',
  '  --mn-duration-fast: 120ms; --mn-ease: cubic-bezier(.2,0,0,1); --mn-radius-lg: 14px; }',
  'html :focus-visible { outline: 2px solid red; box-shadow: 0 0 0 4px white; }',
  'html textarea:focus-visible,',
  "html [contenteditable='true']:focus-visible { outline: none; }",
  '@media (prefers-reduced-motion: reduce) { * { transition-duration: .01ms !important; } }',
].join('\n');

test('接线断言：把映射删掉必须立刻报（这正是本次修掉的原始缺陷）', () => {
  assert.deepEqual(scanWiring(goodExtras(), goodTokens, ''), []);
  const probes = [
    ['fontSize', '缺 fontSize 映射'],
    ['spacing', '缺 spacing 映射'],
    ['zIndex', '缺 zIndex 阶梯'],
    ['transitionDuration', 'DEFAULT 未指向令牌'],
    ['transitionTimingFunction', '缓动默认值未指向令牌'],
  ];
  for (const [key, why] of probes) {
    const broken = goodExtras();
    delete broken[key];
    const got = scanWiring(broken, goodTokens, '');
    assert.ok(got.length >= 1, '删掉 ' + key + ' 应当报（' + why + '）');
  }
  const halfWired = goodExtras();
  halfWired.transitionDuration = { fast: '120ms' };
  assert.ok(scanWiring(halfWired, goodTokens, '').some((f) => /DEFAULT/.test(f.msg)));
});

test('假接线也要报：spacing 存在但不引用 --mn-density，等于没接', () => {
  const fake = goodExtras();
  fake.spacing = { 3: '0.75rem' };
  const got = scanWiring(fake, goodTokens, '');
  assert.ok(
    got.some((f) => /--mn-density/.test(f.msg)),
    '应报"接了个假线"，实际：' + got.map((f) => f.msg).join(' | ')
  );
});

test('焦点环：主规则唯一，别处再写一套要报', () => {
  const twoMain = goodTokens + '\nhtml :focus-visible { outline: none; }';
  assert.ok(
    scanWiring(goodExtras(), twoMain, '').some((f) => /主规则定义了 2 处/.test(f.msg)),
    '两条主规则必须报'
  );
  const stray = goodTokens + '\nbutton:focus-visible { box-shadow: 0 0 0 2px blue; }';
  assert.ok(
    scanWiring(goodExtras(), stray, '').some((f) => /自定义 :focus-visible/.test(f.msg)),
    '组件另写一套焦点环必须报'
  );
  const noExempt = goodTokens
    .split('\n')
    .filter((l) => !/textarea:focus-visible|contenteditable/.test(l))
    .join('\n');
  assert.ok(
    scanWiring(goodExtras(), noExempt, '').some((f) => /书写面豁免/.test(f.msg)),
    '豁免规则丢了要报（否则编辑器常驻粗环）'
  );
});

test('降低动效不许出现第二段', () => {
  const dup =
    '@media (prefers-reduced-motion: reduce) { a{} }\n@media (prefers-reduced-motion: reduce) { b{} }';
  assert.ok(
    scanWiring(goodExtras(), goodTokens, dup).some((f) => /prefers-reduced-motion/.test(f.msg))
  );
  assert.deepEqual(
    scanWiring(goodExtras(), goodTokens, '@media (prefers-reduced-motion: reduce) { a{} }'),
    []
  );
});
