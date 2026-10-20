/**
 * foldersRouter HTTP 层（supertest）测试 —— 补 folders.ts handler 的 51% 缺口
 *
 * 覆盖：GET 列表、POST 创建（顶层 + 子级 + 父不存在 + 深度超限）、PATCH 更新
 * （改名/图标/parentId 变更/branch/防环/不传字段）、DELETE 级联 + 笔记 folderId 归一。
 * getFolderRow / collectDescendantIds / resolveFolderMeta 通过 HTTP 路径间接覆盖。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express, { type Request } from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { foldersRouter } from './folders.js';

let testDb: DatabaseType;
const USER_ID = 'user-folders';
const DEVICE_ID = 'dev-folders';

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES ('${USER_ID}');
    CREATE TABLE folders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      parent_id TEXT,
      icon TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      depth INTEGER NOT NULL DEFAULT 1,
      branch TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      folder_id TEXT,
      ciphertext TEXT NOT NULL DEFAULT 'c',
      key_version INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );
  `);
  vi.mock('../db.js', () => ({ getDb: () => testDb }));
});

afterAll(() => testDb.close());

beforeEach(() => {
  testDb.exec('DELETE FROM notes');
  testDb.exec('DELETE FROM folders');
});

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1', (req: Request, _res, next) => {
    (req as { user?: { userId: string; deviceId: string } }).user = {
      userId: USER_ID,
      deviceId: DEVICE_ID,
    };
    next();
  });
  a.use('/api/v1', foldersRouter);
  return a;
}

const U = {
  top1: '11111111-1111-4111-8111-111111111111',
  top2: '11111111-1111-4111-8111-111111111112',
  child: '11111111-1111-4111-8111-111111111113',
  // depth=2 的一级文件夹，再往里就会超 MAX_FOLDER_DEPTH=2
  mid: '11111111-1111-4111-8111-111111111114',
  leaf: '11111111-1111-4111-8111-111111111115',
};

function seedFolder(
  id: string,
  opts: { parentId?: string | null; depth?: number; branch?: string | null; name?: string } = {}
) {
  testDb
    .prepare(
      `INSERT INTO folders (id, user_id, name, parent_id, icon, depth, branch) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      USER_ID,
      opts.name ?? 'F',
      opts.parentId ?? null,
      null,
      opts.depth ?? 1,
      opts.branch ?? null
    );
}

describe('foldersRouter HTTP handlers', () => {
  describe('GET /folders', () => {
    it('空库 → folders: []', async () => {
      const res = await request(app()).get('/api/v1/folders');
      expect(res.status).toBe(200);
      expect(res.body.folders).toEqual([]);
    });

    it('按 sort_order, created_at 升序返回', async () => {
      seedFolder(U.top1, { name: 'A' });
      seedFolder(U.top2, { name: 'B' });
      const res = await request(app()).get('/api/v1/folders');
      expect(res.status).toBe(200);
      expect(res.body.folders.map((f: { name: string }) => f.name)).toEqual(['A', 'B']);
    });
  });

  describe('POST /folders', () => {
    it('201 创建顶层文件夹（depth=1）', async () => {
      const res = await request(app())
        .post('/api/v1/folders')
        .send({ name: 'Work', branch: 'work' });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      const row = testDb
        .prepare('SELECT depth, branch, parent_id FROM folders WHERE id=?')
        .get(res.body.id) as { depth: number; branch: string; parent_id: string | null };
      expect(row.depth).toBe(1);
      expect(row.branch).toBe('work');
      expect(row.parent_id).toBeNull();
    });

    it('201 创建子文件夹（继承父 depth+1 + branch）', async () => {
      seedFolder(U.top1, { depth: 1, branch: 'work' });
      const res = await request(app())
        .post('/api/v1/folders')
        .send({ name: 'Sub', parentId: U.top1 });
      expect(res.status).toBe(201);
      const row = testDb
        .prepare('SELECT depth, branch FROM folders WHERE id=?')
        .get(res.body.id) as { depth: number; branch: string };
      expect(row.depth).toBe(2);
      expect(row.branch).toBe('work');
    });

    it('父文件夹不存在 → 400 parent_not_found', async () => {
      const res = await request(app())
        .post('/api/v1/folders')
        .send({ name: 'X', parentId: '00000000-0000-4000-8000-000000000099' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('parent_not_found');
    });

    it('深度超限 → 400 folder_depth_exceeded', async () => {
      // 父 depth=2 → 子 depth=3 > MAX_FOLDER_DEPTH=2
      seedFolder(U.mid, { depth: 2, branch: 'work' });
      const res = await request(app())
        .post('/api/v1/folders')
        .send({ name: 'TooDeep', parentId: U.mid });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('folder_depth_exceeded');
    });

    it('非法 body（缺 name）→ 400 invalid_body', async () => {
      const res = await request(app()).post('/api/v1/folders').send({ parentId: null });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_body');
    });

    it('客户端预生成 id 接受', async () => {
      const res = await request(app()).post('/api/v1/folders').send({ id: U.child, name: 'pre' });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe(U.child);
    });
  });

  describe('PATCH /folders/:id', () => {
    it('改名 → 200 ok', async () => {
      seedFolder(U.top1, { name: 'old' });
      const res = await request(app()).patch(`/api/v1/folders/${U.top1}`).send({ name: 'new' });
      expect(res.status).toBe(200);
      const row = testDb.prepare('SELECT name FROM folders WHERE id=?').get(U.top1) as {
        name: string;
      };
      expect(row.name).toBe('new');
    });

    it('非 UUID → 400 missing_id', async () => {
      const res = await request(app()).patch('/api/v1/folders/not-a-uuid').send({ name: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('missing_id');
    });

    it('不存在 → 404 not_found', async () => {
      const res = await request(app())
        .patch('/api/v1/folders/00000000-0000-4000-8000-000000000099')
        .send({ name: 'x' });
      expect(res.status).toBe(404);
    });

    it('parentId = self → 400 parent_is_self（防环）', async () => {
      seedFolder(U.top1);
      const res = await request(app())
        .patch(`/api/v1/folders/${U.top1}`)
        .send({ parentId: U.top1 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('parent_is_self');
    });

    it('parentId = 后代 → 400 parent_is_descendant（防环）', async () => {
      // top1 -> child，尝试把 top1.parent 设为 child
      seedFolder(U.top1);
      seedFolder(U.child, { parentId: U.top1, depth: 2 });
      const res = await request(app())
        .patch(`/api/v1/folders/${U.top1}`)
        .send({ parentId: U.child });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('parent_is_descendant');
    });

    it('parentId 不存在 → 400 parent_not_found', async () => {
      seedFolder(U.top1);
      const res = await request(app())
        .patch(`/api/v1/folders/${U.top1}`)
        .send({ parentId: '00000000-0000-4000-8000-000000000099' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('parent_not_found');
    });

    it('parentId 变更时继承新父 branch + depth+1', async () => {
      seedFolder(U.top1, { depth: 1, branch: 'work' });
      seedFolder(U.top2, { depth: 1, branch: 'personal' });
      const res = await request(app())
        .patch(`/api/v1/folders/${U.top1}`)
        .send({ parentId: U.top2 });
      expect(res.status).toBe(200);
      const row = testDb.prepare('SELECT depth, branch FROM folders WHERE id=?').get(U.top1) as {
        depth: number;
        branch: string;
      };
      expect(row.depth).toBe(2);
      expect(row.branch).toBe('personal');
    });

    it('parentId 变更为 null（升为顶层）+ branch 可改', async () => {
      seedFolder(U.top1, { depth: 1, branch: 'work' });
      seedFolder(U.child, { parentId: U.top1, depth: 2, branch: 'work' });
      const res = await request(app())
        .patch(`/api/v1/folders/${U.child}`)
        .send({ parentId: null, branch: 'personal' });
      expect(res.status).toBe(200);
      const row = testDb
        .prepare('SELECT depth, branch, parent_id FROM folders WHERE id=?')
        .get(U.child) as { depth: number; branch: string; parent_id: string | null };
      expect(row.depth).toBe(1);
      expect(row.branch).toBe('personal');
      expect(row.parent_id).toBeNull();
    });

    it('子文件夹改 branch 被忽略（必须通过 parentId 继承）', async () => {
      seedFolder(U.top1, { depth: 1, branch: 'work' });
      seedFolder(U.child, { parentId: U.top1, depth: 2, branch: 'work' });
      const res = await request(app())
        .patch(`/api/v1/folders/${U.child}`)
        .send({ branch: 'personal' });
      expect(res.status).toBe(200);
      const row = testDb.prepare('SELECT branch FROM folders WHERE id=?').get(U.child) as {
        branch: string;
      };
      // 子级 branch 不应被单独修改
      expect(row.branch).toBe('work');
    });

    it('空 body → 200 ok no-op', async () => {
      seedFolder(U.top1);
      const res = await request(app()).patch(`/api/v1/folders/${U.top1}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('DELETE /folders/:id', () => {
    it('级联删除：父 + 子 + 笔记 folderId 归一 null', async () => {
      // top1 -> child
      seedFolder(U.top1, { depth: 1, branch: 'work' });
      seedFolder(U.child, { parentId: U.top1, depth: 2, branch: 'work' });
      // 笔记在 child 下面
      testDb
        .prepare('INSERT INTO notes (id, user_id, folder_id) VALUES (?, ?, ?)')
        .run('note-1', USER_ID, U.child);
      testDb
        .prepare('INSERT INTO notes (id, user_id, folder_id) VALUES (?, ?, ?)')
        .run('note-2', USER_ID, U.top1);

      const res = await request(app()).delete(`/api/v1/folders/${U.top1}`);
      expect(res.status).toBe(200);

      // top1 + child 都消失
      const remaining = testDb.prepare('SELECT id FROM folders').all() as { id: string }[];
      expect(remaining).toEqual([]);
      // 两条笔记 folderId 都被置 null
      const notes = testDb.prepare('SELECT folder_id FROM notes ORDER BY id').all() as {
        folder_id: string | null;
      }[];
      expect(notes.map((n) => n.folder_id)).toEqual([null, null]);
    });

    it('非 UUID → 400', async () => {
      const res = await request(app()).delete('/api/v1/folders/not-a-uuid');
      expect(res.status).toBe(400);
    });

    it('不存在 → 404', async () => {
      const res = await request(app()).delete(
        '/api/v1/folders/00000000-0000-4000-8000-000000000099'
      );
      expect(res.status).toBe(404);
    });
  });
});
