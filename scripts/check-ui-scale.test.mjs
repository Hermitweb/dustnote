/**
 * UI 门禁自身的测试（跑法：pnpm test:monitoring，已进 CI）
 *
 * 为什么必须给门禁写测试：这次的教训之一就是"验收工具自己坏了三个缺陷，
 * 却从没被验收过"。一个不会红的检查等于没有检查，所以这里逐条喂违例，
 * 确认每条规则真的抓得住；再确认干净样本不误报。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scanClassDiscipline,
  scanWiring,
  scanMotionSync,
  scanEmoji,
  scanDeadDarkVariant,
  scanHardcodedInk,
  scanMpThemeId,
  scanColorLiterals,
  emojiHits,
  OUTLINE_NONE_ALLOWLIST,
} from './check-ui-scale.mjs';

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

/* ── 动效同源 ─────────────────────────────────────────────────────── */
const MOTION_TS = [
  'export const MOTION = {',
  '  fast: 120,',
  '  med: 180,',
  '  slow: 240,',
  "  ease: 'cubic-bezier(0.2, 0, 0, 1)',",
  '} as const;',
].join('\n');
const TOKENS_OK = [
  '  --mn-duration-fast: 120ms;',
  '  --mn-duration-med: 180ms;',
  '  --mn-duration-slow: 240ms;',
  '  --mn-ease: cubic-bezier(0.2, 0, 0, 1);',
].join('\n');
const MP_GEN_OK =
  '--duration-fast: 120ms;\n--duration-med: 180ms;\n--duration-slow: 240ms;\n--ease: cubic-bezier(0.2, 0, 0, 1);';

test('动效同源：三处一致时不报', () => {
  assert.deepEqual(scanMotionSync(MOTION_TS, TOKENS_OK, MP_GEN_OK, '.a { color: red; }'), []);
});

test('动效同源：CSS 抄歪一个数就要报', () => {
  const drifted = TOKENS_OK.replace('180ms', '150ms');
  const got = scanMotionSync(MOTION_TS, drifted, MP_GEN_OK, '');
  assert.equal(got.length, 1, JSON.stringify(got));
  assert.match(got[0].msg, /--mn-duration-med/);
});

test('动效同源：小程序生成文件缺档要报（否则 weapp 悄悄用回默认值）', () => {
  const got = scanMotionSync(MOTION_TS, TOKENS_OK, '--duration-fast: 120ms;', '');
  assert.ok(got.length >= 3, '应报缺 med/slow/ease，实际 ' + got.length);
});

test('动效同源：app.scss 再自己定义一套尺子要报', () => {
  const got = scanMotionSync(MOTION_TS, TOKENS_OK, MP_GEN_OK, '.x { --motion-fast: 160ms; }');
  assert.ok(
    got.some((f) => /第二套尺子/.test(f.msg)),
    JSON.stringify(got)
  );
});

test('动效同源：源头解析不出来时必须报，而不是静默通过', () => {
  const got = scanMotionSync('export const MOTION = {};', TOKENS_OK, MP_GEN_OK, '');
  assert.ok(got.length >= 1, 'motion.ts 结构变了要立刻知道');
});

/* ── emoji 棘轮 ───────────────────────────────────────────────────── */
test('emoji 棘轮：只数界面里的，注释与说明不算', () => {
  const sources = [
    [
      'web/src/A.tsx',
      'const a = <span>⚠️ 警告</span>;\n// 历史：这里曾经是 ⚠️\n/* 注释里 ⚠️ 不算 */\n',
    ],
    ['web/src/B.tsx', '/** 文档 ⚠️ */\nconst b = 1;\n'],
    ['web/src/C.tsx', 'const c = "干净";\n'],
  ];
  const r = scanEmoji(sources, 10);
  assert.equal(r.total, 1, '只有 A 的那一行该被数到：' + JSON.stringify(r.perFile));
  assert.deepEqual(r.findings, []);
});

test('emoji 棘轮：超过上限就报，且把数字打出来（不允许悄悄放宽口径）', () => {
  const sources = [['web/src/A.tsx', '<span>⚠️</span>\n<span>💔</span>\n']];
  const at = scanEmoji(sources, 2);
  assert.equal(at.total, 2);
  assert.deepEqual(at.findings, []);
  const over = scanEmoji(sources, 1);
  assert.equal(over.findings.length, 1);
  assert.match(over.findings[0].msg, /从上限 1 涨到了 2/);
});

test('emoji 棘轮：U+2300 段与当图标用的箭头不再是盲区，键名符号豁免', () => {
  // ⏳ 在 U+23F3：旧正则从 1F300 直跳 2600，SettingsDialog 因此带着它躲过了棘轮
  assert.equal(emojiHits('<span>⏳</span>'), 1, '⏳ 必须被数到');
  // ↩ 在箭头段（2190-21FF 整段仍未纳入），但它被单点列进了图标位黑名单
  assert.equal(emojiHits("{'↩ ' + t('trash.restore')}"), 1, '↩ 当图标用不算键名');
  // ⌘↑↓←→↵ 是键名，出现在快捷键提示里，不算界面图标
  assert.equal(emojiHits('导航 ↑↓ 选择 ⌘K 打开'), 0, '键名符号不得计入');
  // 变体选择器跟着前一个字符，不单独成数；一行两处仍是两处
  assert.equal(emojiHits('<span>⚠️</span>'), 1, '⚠️ 是一个图标，不是两个');
  assert.equal(emojiHits('<span>⏳✦</span>'), 2, '同行两处都要数到');
});

test('dark: 变体是死代码，出现即报', () => {
  assert.deepEqual(scanDeadDarkVariant('web/src/A.tsx', 'const a = "p-2 text-sm";'), []);
  const got = scanDeadDarkVariant(
    'web/src/A.tsx',
    'const a = "border-danger/30 dark:bg-accent/30 dark:[&>b]:hidden";'
  );
  assert.equal(got.length, 1, '两处 dark: 合成一条，指明文件与数量');
  assert.equal(got[0].rule, 'dark-variant');
  assert.match(got[0].msg, /有 2 处/);
});

test('主按钮字面量白/黑：出现即报，遮罩的 bg-black/55 不误伤', () => {
  assert.deepEqual(
    scanHardcodedInk('web/src/A.tsx', 'const a = "fixed inset-0 bg-black/55 p-4";').findings,
    []
  );
  const got = scanHardcodedInk(
    'web/src/A.tsx',
    'const a = "bg-accent-strong text-white";\nconst b = "bg-white";'
  );
  assert.equal(got.n, 2, 'text-white 与 bg-white 各一处');
  assert.match(got.findings[0].msg, /text-accent-strong-on/);
});

test('小程序原生外壳与 CSS 变量必须吃同一份主题种子', () => {
  const chrome = (id) => `const MP_THEME_ID = '${id}';`;
  const gen = (id) => `const THEME_ID = '${id}';`;
  assert.deepEqual(scanMpThemeId(chrome('liquid-glass'), gen('liquid-glass')), []);
  const got = scanMpThemeId(chrome('liquid-glass'), gen('mist-blue'));
  assert.equal(got.length, 1);
  assert.match(got[0].msg, /两套种子/);
  // 解析不出来也要报，不能静默通过
  assert.equal(scanMpThemeId('没有常量', '也没有').length, 1);
});

test('颜色字面量只在样式上下文计数：lib 里的 # 片段不误报、shadow 不掺噪音', () => {
  // 非样式上下文：URL 片段 / 占位串
  assert.deepEqual(
    scanColorLiterals('web/src/lib/x.ts', "const u = 'https://a/#frag';").findings,
    []
  );
  // 阴影：RN 与 CSS 的投影档，明确排除
  assert.deepEqual(scanColorLiterals('mobile/src/A.tsx', "  shadowColor: '#000',").findings, []);
  // 真字面量：要报，且把位置打出来
  const got = scanColorLiterals(
    'mobile/src/A.tsx',
    "  borderColor: '#dc2626',\n  color: rgba(0, 0, 0, 0.5);"
  );
  assert.equal(got.findings.length, 1, '两处合成一条报告，带行号');
  assert.match(got.findings[0].msg, /A\.tsx:1 #dc2626/);
  assert.match(got.findings[0].msg, /A\.tsx:2 rgba/);
  // 逐条豁免：命中允许清单就不报
  const ok = scanColorLiterals(
    'miniprogram/src/app.scss',
    '  border-color: rgba(96, 165, 250, 0.3);'
  );
  assert.deepEqual(ok.findings, []);
  const same = scanColorLiterals(
    'miniprogram/src/other.scss',
    '  border-color: rgba(96, 165, 250, 0.3);'
  );
  assert.equal(same.findings.length, 1, '豁免按文件生效，不是全局放行');
});
