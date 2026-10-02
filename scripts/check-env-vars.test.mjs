/**
 * 环境变量清单守卫自身的测试（跑法：pnpm test:monitoring）
 *
 * 三条由来都在这儿钉着：
 *  1) TS 模板插值 ${'{'}NEW_N{'}'} 不是环境变量（第一版报了 10 条假阳性）；
 *  2) yml 注释里的 ${'{'}PORT:-8080${'}'} 不是读取（第一版报了 PORT / METRICS_TOKEN）；
 *  3) 主栈与监控栈是两份清单，混着查会把 NTFY_TOPIC 报成主栈缺口。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collect,
  declaredInExample,
  envNamesIn,
  kindOf,
  RUNTIME_VARS,
  stripLineComments,
} from './check-env-vars.mjs';

const NL = String.fromCharCode(10);
const BT = String.fromCharCode(96);

test('code 文件：只认 process.env 与 getEnv 两种读法', () => {
  const src = [
    'const a = process.env.JWT_SECRET;',
    'const b = process.env[' + "'METRICS_TOKEN'" + '];',
    'dbPath: getEnv(' + "'DB_PATH'" + ', ' + "'./x'" + '),',
    'k = getEnvOpt(' + "'COOKIE_SECURE'" + ');',
    'const tpl = ' + BT + 'n=${NEW_N} r=${NEW_R}' + BT + ';',
  ].join(NL);
  assert.deepEqual([...envNamesIn(src, 'code')].sort(), [
    'COOKIE_SECURE',
    'DB_PATH',
    'JWT_SECRET',
    'METRICS_TOKEN',
  ]);
});

test('interp 文件：认 ${' + 'VAR} 与 ${' + 'VAR:-默认值} 两种插值', () => {
  const yml = [
    '  port: ${' + 'PORT:-8080}',
    '  - NTFY_TOPIC=${' + 'NTFY_TOPIC}',
    '  plain: $NOT_A_VAR',
  ].join(NL);
  assert.deepEqual([...envNamesIn(yml, 'interp')].sort(), ['NTFY_TOPIC', 'PORT']);
});

test('整行注释不算读取，但行内的 # 不吞', () => {
  const yml = [
    '# 抓宿主上主容器的 /metrics（主栈发布在 ${' + 'PORT:-8080}' + '）',
    '  - ${' + 'METRICS_TOKEN_FILE}' + ':/run/x:ro',
    '  value: "a#b${' + 'KEEP}' + '" # 行尾注释里的 ${' + 'SKIP}' + ' 不该算',
  ].join(NL);
  const names = [...envNamesIn(stripLineComments(yml), 'interp')].sort();
  // 边界如实记录：只剥「整行注释」。行尾注释里的 SKIP 仍会被认成读取——
  // 要正确切它得请 YAML 解析器，而多认一个名字只会让守卫更严，不会漏。
  assert.deepEqual(names, ['KEEP', 'METRICS_TOKEN_FILE', 'SKIP']);
});

test('kindOf 按扩展名分流', () => {
  assert.equal(kindOf('docker-compose.yml'), 'interp');
  assert.equal(kindOf('Dockerfile'), 'interp');
  assert.equal(kindOf('deploy/Caddyfile'), 'interp');
  assert.equal(kindOf('server/src/env.ts'), 'code');
  assert.equal(kindOf('scripts/x.mjs'), 'code');
});

test('.env.example 解析：注释掉的声明也算登记', () => {
  const txt = ['PORT=8080', '# BACKUP_DIR=/x', '# 普通说明', 'JWT_SECRET='].join(NL);
  assert.deepEqual([...declaredInExample(txt)].sort(), ['BACKUP_DIR', 'JWT_SECRET', 'PORT']);
});

test('真实仓库：两个部署面都与清单双向一致', () => {
  const scopes = collect();
  assert.equal(scopes.length, 2, '应有主栈与监控栈两个面');
  for (const sc of scopes) {
    assert.ok(sc.files.length >= 5, sc.name + ' 扫到的文件太少：' + sc.files.length);
    assert.ok(sc.used.size >= 3, sc.name + ' 读到的变量太少，多半是解析失效');
    assert.ok(sc.declared.size >= 3, sc.name + ' 清单太短，manifest 读到了吗');
    const missing = [...sc.used.keys()].filter(
      (n) => !sc.declared.has(n) && !Object.prototype.hasOwnProperty.call(RUNTIME_VARS, n)
    );
    const unread = [...sc.declared].filter((n) => !sc.used.has(n));
    assert.deepEqual(missing, [], sc.name + ' 有变量没登记：' + missing.join(','));
    assert.deepEqual(unread, [], sc.name + ' 有登记却没被读：' + unread.join(','));
  }
});

test('监控栈的变量不会被算成主栈缺口（分面存在的理由）', () => {
  const scopes = collect();
  const app = scopes.find((x) => x.name === '主栈');
  const mon = scopes.find((x) => x.name === '监控栈');
  assert.ok(!app.used.has('NTFY_TOPIC'), 'NTFY_TOPIC 属监控栈，不该出现在主栈读取集里');
  assert.ok(mon.used.has('NTFY_TOPIC'), '监控栈应读到 NTFY_TOPIC');
  assert.ok(mon.declared.has('NTFY_TOPIC'), 'NTFY_TOPIC 应登记在监控栈清单里');
});
