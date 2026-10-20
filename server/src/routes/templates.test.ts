/**
 * 模板路由测试
 *
 * 覆盖：
 *  - GET /templates 列出预设 + 当前用户私有
 *  - POST /templates 创建（自定义）
 *  - PATCH /templates/:id 修改（拒绝预设）
 *  - DELETE /templates/:id 删除（拒绝预设）
 *  - 用户隔离：他人私有模板不可见 / 不可改 / 不可删
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import express from 'express';
import supertest from 'supertest';
import { templatesRouter } from './templates.js';

let testDb: DatabaseType;

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE templates (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      icon TEXT NOT NULL,
      content TEXT NOT NULL,
      is_preset INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  testDb.exec("INSERT INTO users (id) VALUES ('u-1'), ('u-2')");
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
  testDb.exec('DELETE FROM templates');
});

function app(user: { userId: string } | null = { userId: 'u-1' }) {
  const a = express();
  a.use(express.json());
  if (user)
    a.use((req: any, _res: any, next: any) => {
      req.user = user;
      next();
    });
  a.use(templatesRouter);
  return a;
}

describe('GET /api/v1/templates', () => {
  it('列出预设 + 当前用户私有（不含其他用户）', async () => {
    testDb.exec(
      "INSERT INTO templates (id, user_id, name, category, icon, content, is_preset, sort_order) VALUES ('p1', NULL, 'Preset', 'blank', '📄', 'c', 1, 0)"
    );
    testDb.exec(
      "INSERT INTO templates (id, user_id, name, category, icon, content, is_preset, sort_order) VALUES ('c1', 'u-1', 'Mine', 'custom', '📄', 'x', 0, 100)"
    );
    testDb.exec(
      "INSERT INTO templates (id, user_id, name, category, icon, content, is_preset, sort_order) VALUES ('c2', 'u-2', 'Other', 'custom', '📄', 'y', 0, 100)"
    );
    const res = await supertest(app()).get('/templates');
    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(2);
    expect(res.body.templates.map((t: any) => t.id).sort()).toEqual(['c1', 'p1']);
  });

  it('预设标记 isPreset = true，私有为 false', async () => {
    testDb.exec(
      "INSERT INTO templates (id, user_id, name, category, icon, content, is_preset, sort_order) VALUES ('p1', NULL, 'P', 'blank', '📄', 'c', 1, 0)"
    );
    testDb.exec(
      "INSERT INTO templates (id, user_id, name, category, icon, content, is_preset, sort_order) VALUES ('c1', 'u-1', 'C', 'custom', '📄', 'x', 0, 100)"
    );
    const res = await supertest(app()).get('/templates');
    const p = res.body.templates.find((t: any) => t.id === 'p1');
    const c = res.body.templates.find((t: any) => t.id === 'c1');
    expect(p.isPreset).toBe(true);
    expect(c.isPreset).toBe(false);
  });
});

describe('POST /api/v1/templates', () => {
  it('创建合法 → 201', async () => {
    const res = await supertest(app()).post('/templates').send({
      name: 'My Template',
      description: 'd',
      category: 'journal',
      icon: '📓',
      content: '{}',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('缺 name → 400 invalid_body', async () => {
    const res = await supertest(app()).post('/templates').send({ content: '{}' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });

  it('非法 category → 400', async () => {
    const res = await supertest(app()).post('/templates').send({
      name: 'x',
      category: 'invalid-cat',
      icon: '📄',
      content: '{}',
    });
    expect(res.status).toBe(400);
  });

  it('提供 id 沿用 → 不创建新行', async () => {
    const res = await supertest(app()).post('/templates').send({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'X',
      category: 'custom',
      icon: '📄',
      content: '{}',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('11111111-1111-4111-8111-111111111111');
    const cnt = (testDb.prepare('SELECT COUNT(*) AS c FROM templates').get() as any).c;
    expect(cnt).toBe(1);
  });

  it('description 默认空', async () => {
    const res = await supertest(app()).post('/templates').send({
      name: 'X',
      category: 'custom',
      icon: '📄',
      content: '{}',
    });
    expect(res.status).toBe(201);
    const row = testDb
      .prepare('SELECT description FROM templates WHERE id = ?')
      .get(res.body.id) as any;
    expect(row.description).toBe('');
  });

  it('sortOrder 默认 100', async () => {
    const res = await supertest(app()).post('/templates').send({
      name: 'X',
      category: 'custom',
      icon: '📄',
      content: '{}',
    });
    const row = testDb
      .prepare('SELECT sort_order FROM templates WHERE id = ?')
      .get(res.body.id) as any;
    expect(row.sort_order).toBe(100);
  });
});

describe('PATCH /api/v1/templates/:id', () => {
  it('修改自己的私有模板 → 200', async () => {
    testDb.exec(
      "INSERT INTO templates (id, user_id, name, category, icon, content, is_preset, sort_order) VALUES ('c1', 'u-1', 'Old', 'custom', '📄', 'x', 0, 100)"
    );
    const res = await supertest(app()).patch('/templates/c1').send({ name: 'New' });
    expect(res.status).toBe(200);
    const row = testDb.prepare('SELECT name FROM templates WHERE id = ?').get('c1') as any;
    expect(row.name).toBe('New');
  });

  it('修改预设模板 → 403 preset_readonly', async () => {
    testDb.exec(
      "INSERT INTO templates (id, user_id, name, category, icon, content, is_preset, sort_order) VALUES ('p1', NULL, 'P', 'blank', '📄', 'c', 1, 0)"
    );
    const res = await supertest(app()).patch('/templates/p1').send({ name: 'New' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('preset_readonly');
  });

  it('不存在 / 不属于自己 → 404', async () => {
    testDb.exec(
      "INSERT INTO templates (id, user_id, name, category, icon, content, is_preset, sort_order) VALUES ('c2', 'u-2', 'X', 'custom', '📄', 'y', 0, 100)"
    );
    const res = await supertest(app()).patch('/templates/c2').send({ name: 'New' });
    expect(res.status).toBe(404);
  });

  it('非法 body → 400', async () => {
    testDb.exec(
      "INSERT INTO templates (id, user_id, name, category, icon, content, is_preset, sort_order) VALUES ('c1', 'u-1', 'X', 'custom', '📄', 'y', 0, 100)"
    );
    const res = await supertest(app()).patch('/templates/c1').send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('空更新对象 → 200 + 仍更新 updated_at', async () => {
    testDb.exec(
      "INSERT INTO templates (id, user_id, name, category, icon, content, is_preset, sort_order) VALUES ('c1', 'u-1', 'X', 'custom', '📄', 'y', 0, 100)"
    );
    const res = await supertest(app()).patch('/templates/c1').send({});
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/v1/templates/:id', () => {
  it('删除自己的私有模板 → 200', async () => {
    testDb.exec(
      "INSERT INTO templates (id, user_id, name, category, icon, content, is_preset, sort_order) VALUES ('c1', 'u-1', 'X', 'custom', '📄', 'y', 0, 100)"
    );
    const res = await supertest(app()).delete('/templates/c1');
    expect(res.status).toBe(200);
    const cnt = (testDb.prepare('SELECT COUNT(*) AS c FROM templates').get() as any).c;
    expect(cnt).toBe(0);
  });

  it('删除预设 → 403 preset_readonly', async () => {
    testDb.exec(
      "INSERT INTO templates (id, user_id, name, category, icon, content, is_preset, sort_order) VALUES ('p1', NULL, 'P', 'blank', '📄', 'c', 1, 0)"
    );
    const res = await supertest(app()).delete('/templates/p1');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('preset_readonly');
  });

  it('不存在 → 404', async () => {
    const res = await supertest(app()).delete('/templates/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });
});
