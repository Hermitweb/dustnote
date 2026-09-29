/**
 * API 清单生成器的测试（跑法：pnpm test:monitoring）
 *
 * 这条门禁的产物是给人照着写客户端的文档，所以它算错的代价不是「CI 变红」，
 * 而是「一份看起来完整的假文档」。全部用假文件系统喂，不碰仓库真实代码——
 * 真实代码的断言在最后一轮：它必须解析出非空清单且与 docs/api.md 一致。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildInventory,
  parseApp,
  parsePublic,
  render,
  specCoverage,
} from './gen-api-inventory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BT = String.fromCharCode(96);

const APP = [
  "import { authMiddleware } from './middleware/auth.js';",
  "import { authRouter } from './routes/auth.js';",
  "import { noteRouter } from './routes/note.js';",
  "import { shareRouter } from './routes/share.js';",
  "app.use('/api/v1', authRouter);",
  "app.use('/api/v1', authMiddleware);",
  "app.use('/api/v1', noteRouter);",
  "app.use(['/api/v1/x', '/api/v1/y'], shareRouter);",
].join(String.fromCharCode(10));

const AUTH_MW = [
  'const p = req.path;',
  "if (p === '/auth/setup') return next();",
  "if (p === '/health') return next();",
  "if (p.startsWith('/share/')) return next();",
].join(String.fromCharCode(10));

const ROUTES = {
  'server/src/routes/auth.ts': [
    "authRouter.post('/auth/setup', h);",
    "authRouter.post('/auth/unlock', h);",
  ].join(String.fromCharCode(10)),
  'server/src/routes/note.ts': [
    "noteRouter.get('/notes', h);",
    "noteRouter.post('/notes', h);",
  ].join(String.fromCharCode(10)),
  'server/src/routes/share.ts': [
    "shareRouter.get('share/:id', h);", // 故意少写前导斜杠：路径归一也要被验到
  ].join(String.fromCharCode(10)),
};

const fake =
  (extra = {}) =>
  (p) => {
    const map = {
      'server/src/app.ts': APP,
      'server/src/middleware/auth.ts': AUTH_MW,
      ...ROUTES,
      ...extra,
    };
    if (!(p in map)) throw new Error('假文件系统没有这个路径：' + p);
    return map[p];
  };

test('挂载顺序决定认证：authMiddleware 之前的路由公开，之后按需', () => {
  const { rows } = buildInventory(fake());
  const byPath = Object.fromEntries(rows.map((r) => [r.method + ' ' + r.path, r.auth]));
  assert.equal(byPath['POST /api/v1/auth/setup'], '公开', 'authRouter 挂在中间件之前');
  assert.equal(byPath['GET /api/v1/notes'], '需要', 'noteRouter 在中间件之后');
});

test('公开表优先于挂载位置：路由挪到中间件之后，表里的路径仍算公开', () => {
  const A = "app.use('/api/v1', authRouter);";
  const M = "app.use('/api/v1', authMiddleware);";
  // 只换顺序，不增删：authRouter 变成挂在中间件之后
  const app = APP.split(String.fromCharCode(10))
    .map((l) => (l === A ? M : l === M ? A : l))
    .join(String.fromCharCode(10));
  assert.notEqual(app, APP, '构造的变体要真的换了顺序');
  const read = (path) => (path === 'server/src/app.ts' ? app : fake()(path));
  const { rows } = buildInventory(read);
  const setup = rows.find((r) => r.path === '/api/v1/auth/setup');
  const unlock = rows.find((r) => r.path === '/api/v1/auth/unlock');
  assert.ok(setup && unlock, 'authRouter 的路由仍要在清单里');
  assert.equal(setup.auth, '公开', '命中 authMiddleware 的精确公开表');
  assert.equal(unlock.auth, '需要', '没在公开表里就该要认证');
});

test('数组式挂载也要被认出来', () => {
  const { rows } = buildInventory(fake());
  const share = rows.find((r) => r.path === '/api/v1/share/:id');
  assert.ok(share, 'app.use([...], shareRouter) 形式的路由要进清单');
  assert.equal(share.auth, '公开', '/share/ 前缀在公开表里');
});

test('相对路径补斜杠，方法转大写', () => {
  const { rows } = buildInventory(fake());
  assert.ok(
    rows.some((r) => r.path === '/api/v1/share/:id'),
    'share/:id 少了前导斜杠也要补上'
  );
  assert.ok(rows.every((r) => r.method === r.method.toUpperCase()));
});

test('解析不到源文件的 router 必须被报出来，而不是静默少一截', () => {
  const app = APP + String.fromCharCode(10) + "app.use('/api/v1', ghostRouter);";
  const read = (p) => (p === 'server/src/app.ts' ? app : fake()(p));
  const { rows, unresolved } = buildInventory(read);
  assert.deepEqual(unresolved, ['ghostRouter']);
  assert.equal(rows.length, 5, '其余路由仍要正常收全（auth 2 + note 2 + share 1）');
});

test('openapi 覆盖数按参数名归一后统计', () => {
  const { rows } = buildInventory(fake());
  const spec = [
    'openapi: 3.1.0',
    'paths:',
    "  '/notes':",
    '    get:',
    "  '/notes/{id}':",
    '    get:',
  ].join(String.fromCharCode(10));
  const readSpec = (path) => (path === 'docs/openapi.yaml' ? spec : fake()(path));
  const cov = specCoverage(readSpec, rows);
  assert.equal(cov.groups, 2);
  assert.equal(cov.covered, 2, '/notes 与 /notes/:id 都该算覆盖');
});

test('渲染出的表与统计口径一致，且明确标出未覆盖是已知缺口', () => {
  const { rows, pubCount } = buildInventory(fake());
  const page = render(rows, pubCount, { groups: 2, covered: 1 });
  assert.ok(page.includes('共 **' + rows.length + '** 条路由'));
  assert.ok(page.includes('已知缺口'), '不许把没覆盖的部分糊过去');
  for (const r of rows)
    assert.ok(page.includes('| ' + r.method + ' | ' + BT + r.path + BT + ' |'), r.path);
});

test('paths 写成不带引号也要认；写成有 paths 却解析为零要标出来', () => {
  const { rows } = buildInventory(fake());
  const bare = ['openapi: 3.1.0', 'paths:', '  /notes:', '    get:'].join(String.fromCharCode(10));
  const covBare = specCoverage(
    (path) => (path === 'docs/openapi.yaml' ? bare : fake()(path)),
    rows
  );
  assert.equal(covBare.groups, 1, '无引号形式也要解析出来');
  assert.equal(covBare.covered, 2, 'GET 与 POST /notes 都算覆盖');
  // 缩进整体多一级：解析为零，但文件确实声明了 paths: —— 必须标出来，不能报「覆盖 0 条」当结论
  const shifted = bare
    .split(String.fromCharCode(10))
    .map((l) => (l.startsWith('  /') ? ' ' + l : l))
    .join(String.fromCharCode(10));
  const covShift = specCoverage(
    (path) => (path === 'docs/openapi.yaml' ? shifted : fake()(path)),
    rows
  );
  assert.equal(covShift.groups, 0);
  assert.equal(covShift.declared, true, 'declared 为真而 groups 为 0，就是解析器瞎了');
});

test('真实仓库：解析非空、文件都存在、且与已提交的 docs/api.md 一致', () => {
  const real = (p) => readFileSync(join(ROOT, p), 'utf8');
  const { rows, unresolved, pubCount } = buildInventory(real);
  assert.equal(unresolved.length, 0, '有挂载解析不到源文件：' + unresolved.join(', '));
  for (const f of Object.values(parseApp(real).files))
    assert.ok(readFileSync(join(ROOT, f), 'utf8'), f + ' 应可读');
  assert.ok(rows.length > 40, '真实路由应有几十条，实际 ' + rows.length);
  assert.ok(pubCount > 0 && pubCount < rows.length);
  const page = render(rows, pubCount, specCoverage(real, rows));
  const committed = readFileSync(join(ROOT, 'docs/api.md'), 'utf8');
  assert.equal(committed.trim(), page.trim(), 'docs/api.md 与生成结果不一致，请 pnpm api:gen');
});
