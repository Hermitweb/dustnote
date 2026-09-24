/**
 * diagnostics 路由测试（OBS-R03 移动端崩溃上报接收端）
 *
 * 覆盖：
 * - 集成（supertest 打 createApp，TEST-005 harness 同款）：
 *   - 匿名 POST /diagnostics/reports 带合法 X-Client-* 头 → 202 accepted
 *   - 缺版本头 → 被 version-check 拦截（非 202）
 *   - events 超上限 / 结构非法 → 400
 *   - 查看端点无凭据 → 401（接收匿名可达、查看必须鉴权的边界）
 * - 单元：sanitizeDiagText 的 URL 剥离与截断
 */
import { describe, expect, it, vi } from 'vitest';

const TEST_DB = './data/diagnostics-test.db';

const CLIENT_HEADERS = {
  'X-Client-Version': '2.5.43',
  'X-Client-Platform': 'android',
  'X-Client-Device-Id': 'diag-test-device',
  'Content-Type': 'application/json',
};

async function loadApp() {
  vi.resetModules();
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = TEST_DB;
  // 迁移只在 index.ts 主入口跑，createApp 不含——集成测试需自行应用
  // （server-config.test.ts 是纯 handler 单测所以不需要；本文件走 supertest 全栈）
  const { getDb, runMigrations } = await import('../db.js');
  const { migrations } = await import('../migrations.js');
  await runMigrations(getDb(), migrations);
  const { createApp } = await import('../app.js');
  return createApp();
}

function oneEvent(over: Record<string, unknown> = {}) {
  return {
    kind: 'error',
    message: 'TypeError: x is not a function',
    stack: 'at foo (index.android.bundle:1:2)',
    platform: 'android',
    clientVersion: '2.5.43',
    ...over,
  };
}

describe('POST /api/v1/diagnostics/reports（匿名接收）', () => {
  it('合法批量事件 → 202 accepted', { timeout: 30_000 }, async () => {
    const app = await loadApp();
    const supertest = (await import('supertest')).default;
    const res = await supertest(app)
      .post('/api/v1/diagnostics/reports')
      .set(CLIENT_HEADERS)
      .send({
        events: [
          oneEvent(),
          oneEvent({ kind: 'network', message: '/auth/status failed: AbortError' }),
        ],
      });
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(2);
  });

  it('缺 X-Client-* 版本头 → 被 version-check 拒绝', { timeout: 30_000 }, async () => {
    const app = await loadApp();
    const supertest = (await import('supertest')).default;
    const res = await supertest(app)
      .post('/api/v1/diagnostics/reports')
      .set({ 'Content-Type': 'application/json' })
      .send({ events: [oneEvent()] });
    expect(res.status).not.toBe(202);
    expect([400, 403, 412, 426]).toContain(res.status);
  });

  it('events 为空或超过 20 条 → 400', { timeout: 30_000 }, async () => {
    const app = await loadApp();
    const supertest = (await import('supertest')).default;
    const empty = await supertest(app)
      .post('/api/v1/diagnostics/reports')
      .set(CLIENT_HEADERS)
      .send({ events: [] });
    expect(empty.status).toBe(400);
    const tooMany = await supertest(app)
      .post('/api/v1/diagnostics/reports')
      .set(CLIENT_HEADERS)
      .send({ events: Array.from({ length: 21 }, () => oneEvent()) });
    expect(tooMany.status).toBe(400);
  });

  it('非法 platform / kind → 400', { timeout: 30_000 }, async () => {
    const app = await loadApp();
    const supertest = (await import('supertest')).default;
    const res = await supertest(app)
      .post('/api/v1/diagnostics/reports')
      .set(CLIENT_HEADERS)
      .send({ events: [oneEvent({ platform: 'windows' })] });
    expect(res.status).toBe(400);
  });
});

describe('GET/DELETE /api/v1/diagnostics（必须鉴权）', () => {
  it('无凭据访问 → 401', { timeout: 30_000 }, async () => {
    const app = await loadApp();
    const supertest = (await import('supertest')).default;
    const get = await supertest(app).get('/api/v1/diagnostics').set(CLIENT_HEADERS);
    expect(get.status).toBe(401);
    const del = await supertest(app).delete('/api/v1/diagnostics').set(CLIENT_HEADERS);
    expect(del.status).toBe(401);
  });
});

describe('sanitizeDiagText', () => {
  it('剥离 URL 并硬截断', async () => {
    const { sanitizeDiagText } = await import('./diagnostics.js');
    expect(sanitizeDiagText('GET https://api.example.com/x?token=abc failed', 600)).toBe(
      'GET [url] failed'
    );
    expect(sanitizeDiagText('a'.repeat(1000), 600)).toHaveLength(600);
    expect(sanitizeDiagText(undefined, 600)).toBeUndefined();
    expect(sanitizeDiagText('', 600)).toBeUndefined();
  });
});
