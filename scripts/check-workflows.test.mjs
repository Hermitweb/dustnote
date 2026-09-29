/**
 * workflow 守卫自身的测试（跑法：pnpm test:monitoring）
 *
 * 这条守卫的由来就是一次「看起来没问题、实际整份 CI 不会跑」的漏写，
 * 所以它自己必须被钉住：把 runs-on 删掉，测试就要红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAll, checkWorkflow } from './check-workflows.mjs';

const OK = [
  'name: demo',
  'on: [push]',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    timeout-minutes: 10',
  '    steps:',
  '      - run: echo hi',
  '  ship:',
  '    needs: [build]',
  '    runs-on: ubuntu-latest',
  '    timeout-minutes: 5',
  '    environment:',
  '      name: github-pages',
  '      url: https://example.invalid/page/',
  '    steps:',
  '      - run: echo ship',
].join(String.fromCharCode(10));

test('结构完整的 workflow 不报问题', () => {
  assert.deepEqual(checkWorkflow(OK, 'demo.yml'), []);
});

test('缺 runs-on 必须报（GitHub 会整份拒绝，所有 job 静默不跑）', () => {
  const broken = OK.replace(
    '    runs-on: ubuntu-latest' +
      String.fromCharCode(10) +
      '    timeout-minutes: 5' +
      String.fromCharCode(10),
    '    timeout-minutes: 5' + String.fromCharCode(10)
  );
  assert.notEqual(broken, OK, '构造的坏例子要真的坏');
  const problems = checkWorkflow(broken, 'demo.yml');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /缺 runs-on/);
});

test('needs 指向不存在的 job 必须报', () => {
  const problems = checkWorkflow(OK.replace('needs: [build]', 'needs: [biuld]'), 'demo.yml');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /needs 指向不存在的 job：biuld/);
});

test('needs 写成单个字符串时不能被当成字符数组', () => {
  // needs: probe 是合法写法。若只认数组与映射，字符串会被 Object.keys 拆成
  // 0..n 的字符下标，于是报出一串没人看得懂的「needs 指向不存在的 job：0」。
  const one = OK.replace('    needs: [build]', '    needs: build');
  assert.ok(one !== OK, '构造的变体要真的变了');
  assert.deepEqual(checkWorkflow(one, 'demo.yml'), []);
  const typo = OK.replace('    needs: [build]', '    needs: biuld');
  const problems = checkWorkflow(typo, 'demo.yml');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /不存在的 job：biuld/);
});

test('缺 timeout-minutes 必须报', () => {
  const problems = checkWorkflow(
    OK.replace('    timeout-minutes: 10' + String.fromCharCode(10), ''),
    'demo.yml'
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /timeout-minutes/);
});

test('environment.url 写明文 http 必须报，GitHub 表达式放行', () => {
  const http = checkWorkflow(
    OK.replace('url: https://example.invalid/page/', 'url: http://example.invalid/page/'),
    'demo.yml'
  );
  assert.equal(http.length, 1);
  assert.match(http[0], /不是 https/);
  const expr = checkWorkflow(
    OK.replace(
      'url: https://example.invalid/page/',
      'url: ' + String.fromCharCode(36) + '{{ steps.x.outputs.url }}'
    ),
    'demo.yml'
  );
  assert.deepEqual(expr, []);
});

test('YAML 语法错要报解析失败而不是抛异常', () => {
  const problems = checkWorkflow('name: demo\njobs:\n  a: [1, 2\n', 'bad.yml');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /YAML 解析失败/);
});

test('复用工作流（uses）的 job 不要求 runs-on / steps', () => {
  const reusable = [
    'name: demo',
    'on: [push]',
    'jobs:',
    '  call:',
    '    uses: ./.github/workflows/other.yml',
    '    timeout-minutes: 10',
  ].join(String.fromCharCode(10));
  assert.deepEqual(checkWorkflow(reusable, 'reusable.yml'), []);
});

test('仓库里真实的 workflow 全部通过', () => {
  const { files, problems } = checkAll();
  assert.ok(files.length >= 5, '至少该扫到几份 workflow，实际 ' + files.length);
  assert.deepEqual(problems, []);
});
