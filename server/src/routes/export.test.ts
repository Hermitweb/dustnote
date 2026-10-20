/**
 * 导出路由测试
 *
 * 覆盖：
 *  - GET /export/notes/:id：UUID 校验、json 格式、md/html 501、404、Content-Disposition 安全
 *  - GET /export/backup：打包所有 notes/folders/tags、Content-Disposition 含日期
 *  - 防止 setHeader 500：URL 编码字符不被允许进 filename
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import express from 'express';
import supertest from 'supertest';
import { exportRouter } from './export.js';

let testDb: DatabaseType;

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE folders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      parent_id TEXT,
      icon TEXT
    );
    CREATE TABLE tags (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT
    );
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ciphertext TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      client_updated_at TEXT NOT NULL,
      server_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      folder_id TEXT
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
  testDb.exec('DELETE FROM notes');
  testDb.exec('DELETE FROM folders');
  testDb.exec('DELETE FROM tags');
});

function app(user: { userId: string } | null = { userId: 'u-1' }) {
  const a = express();
  a.use(express.json());
  if (user)
    a.use((req: any, _res: any, next: any) => {
      req.user = user;
      next();
    });
  a.use(exportRouter);
  return a;
}

const NOTE_ID = '11111111-1111-4111-8111-111111111111';

describe('GET /api/v1/export/notes/:id', () => {
  it('合法 UUID + 存在笔记 → 返回 JSON + Content-Disposition', async () => {
    testDb.exec(`INSERT INTO notes (id, user_id, ciphertext, client_updated_at) VALUES
      ('${NOTE_ID}', 'u-1', '{"v":1,"x":1}', '2026-01-01T00:00:00Z')`);
    const res = await supertest(app()).get(`/export/notes/${NOTE_ID}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="dustnote-${NOTE_ID}.json"`
    );
    const body = JSON.parse(res.text);
    expect(body.format).toBe('dustnote.v1');
    expect(body.note.id).toBe(NOTE_ID);
    expect(body.note.ciphertext).toEqual({ v: 1, x: 1 });
  });

  it('非法 UUID（含 URL 编码字符）→ 400 invalid_id', async () => {
    const res = await supertest(app()).get('/export/notes/..%2F..%2Fetc%2Fpasswd');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_id');
  });

  it('UUID 但不存在 → 404', async () => {
    const res = await supertest(app()).get(`/export/notes/00000000-0000-4000-8000-000000000000`);
    expect(res.status).toBe(404);
  });

  it('不属于自己的笔记 → 404', async () => {
    testDb.exec("INSERT INTO users (id) VALUES ('u-2')");
    testDb.exec(`INSERT INTO notes (id, user_id, ciphertext, client_updated_at) VALUES
      ('${NOTE_ID}', 'u-2', '{"v":1}', '2026-01-01T00:00:00Z')`);
    const res = await supertest(app()).get(`/export/notes/${NOTE_ID}`);
    expect(res.status).toBe(404);
  });

  it('format=md → 501 unsupported_format', async () => {
    testDb.exec(`INSERT INTO notes (id, user_id, ciphertext, client_updated_at) VALUES
      ('${NOTE_ID}', 'u-1', '{"v":1}', '2026-01-01T00:00:00Z')`);
    const res = await supertest(app()).get(`/export/notes/${NOTE_ID}?format=md`);
    expect(res.status).toBe(501);
  });

  it('非法 format → 400 invalid_query', async () => {
    testDb.exec(`INSERT INTO notes (id, user_id, ciphertext, client_updated_at) VALUES
      ('${NOTE_ID}', 'u-1', '{"v":1}', '2026-01-01T00:00:00Z')`);
    const res = await supertest(app()).get(`/export/notes/${NOTE_ID}?format=xml`);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/export/backup', () => {
  it('空库 → 返回合法 payload', async () => {
    const res = await supertest(app()).get('/export/backup');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/dustnote-backup-\d{4}-\d{2}-\d{2}\.json/);
    const body = JSON.parse(res.text);
    expect(body.format).toBe('dustnote-backup.v1');
    expect(body.notes).toEqual([]);
    expect(body.folders).toEqual([]);
    expect(body.tags).toEqual([]);
  });

  it('打包所有 notes/folders/tags', async () => {
    testDb.exec(`INSERT INTO notes (id, user_id, ciphertext, is_pinned, is_favorite, client_updated_at) VALUES
      ('${NOTE_ID}', 'u-1', '{"v":1,"a":1}', 1, 0, '2026-01-01T00:00:00Z')`);
    testDb.exec(`INSERT INTO folders (id, user_id, name, parent_id, icon) VALUES
      ('22222222-2222-4222-8222-222222222222', 'u-1', 'Work', NULL, '💼')`);
    testDb.exec(`INSERT INTO tags (id, user_id, name, color) VALUES
      ('33333333-3333-4333-8333-333333333333', 'u-1', 'urgent', '#ff0000')`);
    const res = await supertest(app()).get('/export/backup');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].ciphertext).toEqual({ v: 1, a: 1 });
    expect(body.notes[0].isPinned).toBe(true);
    expect(body.folders).toHaveLength(1);
    expect(body.folders[0].name).toBe('Work');
    expect(body.tags).toHaveLength(1);
    expect(body.tags[0].color).toBe('#ff0000');
  });
});
