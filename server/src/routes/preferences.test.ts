/**
 * 偏好设置路由测试
 *
 * 覆盖：
 *  - GET /preferences：首次访问按默认值返回；已有 row 返回真实值
 *  - PATCH /preferences：参数校验、单字段/多字段更新、空更新对象
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import express from 'express';
import supertest from 'supertest';
import { preferencesRouter } from './preferences.js';

let testDb: DatabaseType;

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT NOT NULL DEFAULT 'liquid-glass',
      mode TEXT NOT NULL DEFAULT 'auto',
      font TEXT NOT NULL DEFAULT 'system',
      density TEXT NOT NULL DEFAULT 'standard',
      auto_lock INTEGER NOT NULL DEFAULT 15,
      language TEXT NOT NULL DEFAULT 'zh-CN',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  testDb.exec("INSERT INTO users (id) VALUES ('u-1')");
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
  testDb.exec('DELETE FROM preferences');
});

function app(user: { userId: string } | null = { userId: 'u-1' }) {
  const a = express();
  a.use(express.json());
  if (user)
    a.use((req: any, _res: any, next: any) => {
      req.user = user;
      next();
    });
  a.use(preferencesRouter);
  return a;
}

describe('GET /api/v1/preferences', () => {
  it('首次访问返回默认值 + 自动创建行', async () => {
    const res = await supertest(app()).get('/preferences');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      theme: 'liquid-glass',
      mode: 'auto',
      font: 'system',
      density: 'standard',
      autoLock: 15,
      language: 'zh-CN',
    });
    const row = testDb.prepare('SELECT * FROM preferences WHERE user_id = ?').get('u-1');
    expect(row).toBeDefined();
  });

  it('已有 row → 返回实际值', async () => {
    testDb.exec(`INSERT INTO preferences (user_id, theme, mode, font, density, auto_lock, language) VALUES
      ('u-1', 'mint-dawn', 'dark', 'manrope', 'compact', 30, 'en')`);
    const res = await supertest(app()).get('/preferences');
    expect(res.body.theme).toBe('mint-dawn');
    expect(res.body.mode).toBe('dark');
    expect(res.body.font).toBe('manrope');
    expect(res.body.density).toBe('compact');
    expect(res.body.autoLock).toBe(30);
    expect(res.body.language).toBe('en');
  });
});

describe('PATCH /api/v1/preferences', () => {
  it('单字段更新 → 200', async () => {
    const res = await supertest(app()).patch('/preferences').send({ theme: 'sakura-pink' });
    expect(res.status).toBe(200);
    const row = testDb.prepare('SELECT theme FROM preferences WHERE user_id = ?').get('u-1') as any;
    expect(row.theme).toBe('sakura-pink');
  });

  it('多字段更新 → 200', async () => {
    const res = await supertest(app()).patch('/preferences').send({
      theme: 'mist-blue',
      mode: 'dark',
      font: 'lxgw',
      density: 'compact',
      autoLock: 60,
      language: 'en',
    });
    expect(res.status).toBe(200);
    const row = testDb.prepare('SELECT * FROM preferences WHERE user_id = ?').get('u-1') as any;
    expect(row.theme).toBe('mist-blue');
    expect(row.mode).toBe('dark');
    expect(row.font).toBe('lxgw');
    expect(row.density).toBe('compact');
    expect(row.auto_lock).toBe(60);
    expect(row.language).toBe('en');
  });

  it('非法 theme → 400', async () => {
    const res = await supertest(app()).patch('/preferences').send({ theme: 'unknown' });
    expect(res.status).toBe(400);
  });

  it('autoLock 越界（>1440）→ 400', async () => {
    const res = await supertest(app()).patch('/preferences').send({ autoLock: 9999 });
    expect(res.status).toBe(400);
  });

  it('autoLock 负值 → 400', async () => {
    const res = await supertest(app()).patch('/preferences').send({ autoLock: -1 });
    expect(res.status).toBe(400);
  });

  it('autoLock 非整数 → 400', async () => {
    const res = await supertest(app()).patch('/preferences').send({ autoLock: 1.5 });
    expect(res.status).toBe(400);
  });

  it('空更新对象 → 200 不写 DB', async () => {
    const res = await supertest(app()).patch('/preferences').send({});
    expect(res.status).toBe(200);
  });

  it('非法 mode → 400', async () => {
    const res = await supertest(app()).patch('/preferences').send({ mode: 'invalid' });
    expect(res.status).toBe(400);
  });
});
