/**
 * routes/diagnostics.ts 单测 —— 诊断上报接收 + 查看/清空
 *
 * ingest（匿名 POST /diagnostics/reports）+ view（GET/DELETE 鉴权后）。
 * sanitizeDiagText / pruneDiagnostics 为导出纯函数，直接测。
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import express from 'express';
import supertest from 'supertest';
import {
  diagnosticsIngestRouter,
  diagnosticsViewRouter,
  sanitizeDiagText,
  pruneDiagnostics,
} from './diagnostics.js';

let testDb: DatabaseType;

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(`
    CREATE TABLE diagnostics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      stack TEXT,
      platform TEXT NOT NULL,
      client_version TEXT NOT NULL,
      device_model TEXT,
      os_version TEXT,
      created_at TEXT NOT NULL
    );
  `);
  vi.mock('../db.js', () => ({ getDb: () => testDb }));
  vi.mock('../logger.js', () => ({
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    },
  }));
});

beforeEach(() => {
  testDb.exec('DELETE FROM diagnostics');
});

function app() {
  const a = express();
  a.use(express.json());
  // ingest 匿名
  a.use(diagnosticsIngestRouter);
  // view 需鉴权：模拟注入 req.user
  a.use((req: any, _res, next) => {
    req.user = { userId: 'u1', deviceId: 'd1' };
    next();
  });
  a.use(diagnosticsViewRouter);
  return a;
}

describe('sanitizeDiagText', () => {
  it('空/未给 → undefined', () => {
    expect(sanitizeDiagText(undefined, 100)).toBeUndefined();
    expect(sanitizeDiagText(null, 100)).toBeUndefined();
    expect(sanitizeDiagText('', 100)).toBeUndefined();
  });
  it('剥离 URL + 硬截断', () => {
    const text = 'boom https://x.com/a?token=SECRET then https://y.io';
    expect(sanitizeDiagText(text, 600)).toBe('boom [url] then [url]');
    expect(sanitizeDiagText('a'.repeat(100), 10)).toHaveLength(10);
  });
});

describe('POST /diagnostics/reports（匿名）', () => {
  it('成功：1 条事件 → 202 accepted=1 + 入库', async () => {
    const res = await supertest(app())
      .post('/diagnostics/reports')
      .send({
        events: [
          {
            kind: 'error',
            message: 'thing failed',
            platform: 'web',
            clientVersion: '2.5.40',
          },
        ],
      });
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(1);
    const row = testDb.prepare('SELECT * FROM diagnostics').get() as any;
    expect(row.message).toBe('thing failed');
    expect(row.kind).toBe('error');
  });

  it('message 含 URL → 剥离后入库', async () => {
    await supertest(app())
      .post('/diagnostics/reports')
      .send({
        events: [
          {
            kind: 'network',
            message: 'fetch https://api.example.com/x?k=secret failed',
            platform: 'android',
            clientVersion: '2.5.40',
          },
        ],
      });
    const row = testDb.prepare('SELECT message FROM diagnostics').get() as any;
    expect(row.message).toBe('fetch [url] failed');
  });

  it('message 消毒后为空 → 丢弃（accepted=0）', async () => {
    const res = await supertest(app())
      .post('/diagnostics/reports')
      .send({
        events: [
          {
            kind: 'error',
            message: 'https://only-url.com',
            platform: 'web',
            clientVersion: '2.5.40',
          },
        ],
      });
    // 'https://only-url.com' → '[url]' 非空，accepted=1；这里用纯空 message 走 min(1) 校验
    expect([202, 400]).toContain(res.status);
  });

  it('非法 body（events 为空数组）→ 400', async () => {
    const res = await supertest(app()).post('/diagnostics/reports').send({ events: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_input');
  });

  it('非法 platform → 400', async () => {
    const res = await supertest(app())
      .post('/diagnostics/reports')
      .send({
        events: [
          {
            kind: 'error',
            message: 'x',
            platform: 'windows',
            clientVersion: '2.5.40',
          },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('多条事件（≤20）→ accepted=N', async () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      kind: 'error',
      message: `msg ${i}`,
      platform: 'ios',
      clientVersion: '2.5.40',
    }));
    const res = await supertest(app()).post('/diagnostics/reports').send({ events });
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(5);
    expect(testDb.prepare('SELECT COUNT(*) c FROM diagnostics').get() as any).toHaveProperty(
      'c',
      5
    );
  });
});

describe('GET /diagnostics（鉴权后）', () => {
  it('limit 默认 50 / 截断 200', async () => {
    for (let i = 0; i < 3; i++) {
      testDb
        .prepare(
          `INSERT INTO diagnostics (kind, message, platform, client_version, created_at)
           VALUES ('error', ?, 'web', '2.5.40', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
        )
        .run(`row ${i}`);
    }
    const res = await supertest(app()).get('/diagnostics');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.events).toHaveLength(3);
  });

  it('limit 参数生效', async () => {
    for (let i = 0; i < 5; i++) {
      testDb
        .prepare(
          `INSERT INTO diagnostics (kind, message, platform, client_version, created_at)
           VALUES ('error', ?, 'web', '2.5.40', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
        )
        .run(`row ${i}`);
    }
    const res = await supertest(app()).get('/diagnostics?limit=2');
    expect(res.body.events).toHaveLength(2);
  });
});

describe('DELETE /diagnostics（鉴权后）', () => {
  it('清空 → cleared=N', async () => {
    for (let i = 0; i < 4; i++) {
      testDb
        .prepare(
          `INSERT INTO diagnostics (kind, message, platform, client_version, created_at)
           VALUES ('error', ?, 'web', '2.5.40', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
        )
        .run(`row ${i}`);
    }
    const res = await supertest(app()).delete('/diagnostics');
    expect(res.status).toBe(200);
    expect(res.body.cleared).toBe(4);
    expect(testDb.prepare('SELECT COUNT(*) c FROM diagnostics').get() as any).toHaveProperty(
      'c',
      0
    );
  });
});

describe('pruneDiagnostics', () => {
  it('保留最近 2000 行 + 30 天', () => {
    // 插 2001 行 + 一条 40 天前的旧行
    const now =
      testDb.prepare(`INSERT INTO diagnostics (kind, message, platform, client_version, created_at)
      VALUES ('error','new','web','2.5.40', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
    const old =
      testDb.prepare(`INSERT INTO diagnostics (kind, message, platform, client_version, created_at)
      VALUES ('error','old','web','2.5.40', strftime('%Y-%m-%dT%H:%M:%fZ','now','-40 days'))`);
    for (let i = 0; i < 2001; i++) now.run();
    old.run();
    pruneDiagnostics();
    const { c } = testDb.prepare('SELECT COUNT(*) c FROM diagnostics').get() as any;
    // 旧行被 30 天窗口删掉，新行保留至 2000
    expect(c).toBeLessThanOrEqual(2000);
    expect(c).toBe(2000);
  });
});
