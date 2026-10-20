/**
 * 标签路由测试
 *
 * 验证 GET/POST/DELETE tag + note-tag 关联：参数校验、用户隔离、UNIQUE 冲突。
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import express from 'express';
import supertest from 'supertest';
import { tagsRouter } from './tags.js';

let testDb: DatabaseType;

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE tags (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT,
      UNIQUE(user_id, name)
    );
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ciphertext BLOB NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE note_tags (
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      UNIQUE(note_id, tag_id)
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
  testDb.exec('DELETE FROM note_tags');
  testDb.exec('DELETE FROM tags');
  testDb.exec('DELETE FROM notes');
  // 重置 seed 数据
  testDb.exec(`INSERT INTO tags (id, user_id, name) VALUES
    ('11111111-1111-4111-8111-111111111111','u-1','work'),
    ('22222222-2222-4222-8222-222222222222','u-2','private')`);
  testDb.exec(`INSERT INTO notes (id, user_id, ciphertext) VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','u-1', x'deadbeef')`);
});

function app(user: { userId: string } | null = { userId: 'u-1' }) {
  const a = express();
  a.use(express.json());
  if (user)
    a.use((req: any, _res: any, next: any) => {
      req.user = user;
      next();
    });
  a.use(tagsRouter);
  return a;
}

describe('GET /api/v1/tags', () => {
  it('返回当前用户的标签，按 count desc, name asc', async () => {
    testDb.exec(`INSERT INTO notes (id, user_id, ciphertext) VALUES
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','u-1',x'deadbeef'),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','u-1',x'deadbeef'),
      ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','u-1',x'deadbeef')`);
    testDb.exec(`INSERT INTO tags (id, user_id, name) VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','u-1','idea'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','u-1','archive')`);
    testDb.exec(`INSERT INTO note_tags (note_id, tag_id) VALUES
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111'),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111'),
      ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')`);
    const res = await supertest(app()).get('/tags');
    expect(res.status).toBe(200);
    expect(res.body.tags.map((t: any) => t.name)).toEqual(['work', 'idea', 'archive']);
    expect(res.body.tags.find((t: any) => t.name === 'work').count).toBe(2);
    expect(res.body.tags.find((t: any) => t.name === 'idea').count).toBe(1);
    expect(res.body.tags.find((t: any) => t.name === 'archive').count).toBe(0);
  });

  it('不返回其他用户的标签', async () => {
    const res = await supertest(app()).get('/tags');
    expect(res.body.tags.find((t: any) => t.name === 'private')).toBeUndefined();
  });

  it('软删除的笔记不计入 count', async () => {
    testDb.exec(`INSERT INTO notes (id, user_id, ciphertext, deleted_at) VALUES
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','u-1',x'deadbeef',NULL),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','u-1',x'deadbeef',datetime('now'))`);
    testDb.exec(`INSERT INTO note_tags (note_id, tag_id) VALUES
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111'),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111')`);
    const res = await supertest(app()).get('/tags');
    expect(res.body.tags.find((t: any) => t.name === 'work').count).toBe(1);
  });
});

describe('POST /api/v1/tags', () => {
  it('创建合法 tag → 201', async () => {
    const res = await supertest(app()).post('/tags').send({ name: 'idea', color: '#ff0000' });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('缺 name → 400 invalid_body', async () => {
    const res = await supertest(app()).post('/tags').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });

  it('非法 color → 400', async () => {
    const res = await supertest(app()).post('/tags').send({ name: 'x', color: 'red' });
    expect(res.status).toBe(400);
  });

  it('同名同用户 → 409 tag_exists', async () => {
    // seed 中已存在 u-1 的 'work'，直接尝试同名 → 409
    const dup = await supertest(app()).post('/tags').send({ name: 'work' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('tag_exists');
  });
});

describe('DELETE /api/v1/tags/:id', () => {
  it('合法 → 200', async () => {
    const res = await supertest(app()).delete('/tags/11111111-1111-4111-8111-111111111111');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('非法 UUID → 400', async () => {
    const res = await supertest(app()).delete('/tags/not-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_id');
  });

  it('不属于自己 → 404（不泄露存在性）', async () => {
    const res = await supertest(app()).delete('/tags/22222222-2222-4222-8222-222222222222');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/note-tags', () => {
  it('打标签成功 → 201', async () => {
    const res = await supertest(app()).post('/note-tags').send({
      noteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tagId: '11111111-1111-4111-8111-111111111111',
    });
    expect(res.status).toBe(201);
  });

  it('noteId 不存在 → 404', async () => {
    const res = await supertest(app()).post('/note-tags').send({
      noteId: '00000000-0000-4000-8000-000000000000',
      tagId: '11111111-1111-4111-8111-111111111111',
    });
    expect(res.status).toBe(404);
  });

  it('tagId 不存在 → 404', async () => {
    const res = await supertest(app()).post('/note-tags').send({
      noteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tagId: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.status).toBe(404);
  });

  it('非法 UUID → 400', async () => {
    const res = await supertest(app()).post('/note-tags').send({ noteId: 'x', tagId: 'y' });
    expect(res.status).toBe(400);
  });

  it('重复打标签 → 409 already_tagged', async () => {
    testDb.exec(
      `INSERT INTO note_tags (note_id, tag_id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111')`
    );
    const res = await supertest(app()).post('/note-tags').send({
      noteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tagId: '11111111-1111-4111-8111-111111111111',
    });
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/v1/note-tags', () => {
  it('取消标签成功 → 200', async () => {
    testDb.exec(
      `INSERT INTO note_tags (note_id, tag_id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111')`
    );
    const res = await supertest(app()).delete('/note-tags').send({
      noteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tagId: '11111111-1111-4111-8111-111111111111',
    });
    expect(res.status).toBe(200);
    const row = testDb.prepare('SELECT * FROM note_tags').get();
    expect(row).toBeUndefined();
  });

  it('纵深防御：跨用户不可取消', async () => {
    // u-2 的 tag 与 u-1 的 note 形成非法关联 —— 删除时应被拒绝
    testDb.exec(
      `INSERT INTO note_tags (note_id, tag_id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222')`
    );
    const res = await supertest(app()).delete('/note-tags').send({
      noteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tagId: '22222222-2222-4222-8222-222222222222',
    });
    expect(res.status).toBe(200); // 返回 ok（无副作用）
    const row = testDb.prepare('SELECT * FROM note_tags').get();
    expect(row).toBeDefined(); // 但未删除
  });

  it('非法 body → 400', async () => {
    const res = await supertest(app()).delete('/note-tags').send({ noteId: 'x', tagId: 'y' });
    expect(res.status).toBe(400);
  });
});
