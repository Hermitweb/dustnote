/**
 * 文件夹路由数据层单元测试（目录结构范式：深度封顶 + 顶层二元隔离 + 级联删除）
 *
 * folders.ts 的 handler 是纯 DB 逻辑薄封装，这里直接调用导出的 handler
 * （mock getDb），验证：
 * - resolveFolderMeta：顶层默认分支 / 显式分支 / 子级继承
 * - createFolder：一级 depth=1、二级 depth=2、三级被拦截（folder_depth_exceeded）
 * - deleteFolder：级联删除后代，避免 parent_id 悬空，笔记 folder_id 置空
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

let testDb: DatabaseType;

function seedFolder(id: string, parentId: string | null, depth: number, branch: string | null) {
  testDb
    .prepare(
      `INSERT INTO folders (id, user_id, name, parent_id, depth, branch) VALUES (?, 'user-1', ?, ?, ?, ?)`
    )
    .run(id, `f-${id}`, parentId, depth, branch);
}

function seedNote(id: string, folderId: string | null) {
  testDb
    .prepare(`INSERT INTO notes (id, user_id, folder_id) VALUES (?, 'user-1', ?)`)
    .run(id, folderId);
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

function mockReq(body: unknown, params: Record<string, string> = {}) {
  return { user: { userId: 'user-1' }, body, params } as never;
}

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES ('user-1');
    CREATE TABLE folders (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      parent_id  TEXT REFERENCES folders(id) ON DELETE SET NULL,
      icon       TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      depth      INTEGER NOT NULL DEFAULT 1,
      branch     TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE notes (
      id        TEXT PRIMARY KEY,
      user_id   TEXT NOT NULL,
      folder_id TEXT
    );
  `);

  vi.mock('../db.js', () => ({
    getDb: () => testDb,
  }));
});

afterAll(() => {
  testDb.close();
});

// 必须在 vi.mock 之后导入，才能拿到 mock 后的 getDb
import {
  resolveFolderMeta,
  createFolder,
  deleteFolder,
  collectDescendantIds,
} from './folders.js';

describe('resolveFolderMeta（纯逻辑）', () => {
  it('顶层缺省分支为 null（无预设分支，由用户自由创建）', () => {
    expect(resolveFolderMeta(undefined, undefined)).toEqual({ depth: 1, branch: null });
  });
  it('顶层显式指定 personal', () => {
    expect(resolveFolderMeta(undefined, 'personal')).toEqual({ depth: 1, branch: 'personal' });
  });
  it('子文件夹继承父分支并 +1 深度，忽略传入分支', () => {
    expect(resolveFolderMeta({ depth: 1, branch: 'work' }, 'personal')).toEqual({
      depth: 2,
      branch: 'work',
    });
  });
});

describe('createFolder（深度封顶 + 二元隔离）', () => {
  it('创建一级文件夹：depth=1，缺省 branch=null', () => {
    const res = mockRes();
    createFolder(mockReq({ name: '工作' }), res as never);
    expect(res.statusCode).toBe(201);
    const row = testDb
      .prepare('SELECT depth, branch FROM folders WHERE name = ?')
      .get('工作') as { depth: number; branch: string | null };
    expect(row.depth).toBe(1);
    expect(row.branch).toBeNull();
  });

  it('创建二级文件夹：depth=2，继承父分支', () => {
    seedFolder('p1', null, 1, 'personal');
    const res = mockRes();
    createFolder(mockReq({ name: '子夹', parentId: 'p1' }), res as never);
    expect(res.statusCode).toBe(201);
    const row = testDb
      .prepare('SELECT depth, branch FROM folders WHERE name = ?')
      .get('子夹') as { depth: number; branch: string | null };
    expect(row.depth).toBe(2);
    expect(row.branch).toBe('personal');
  });

  it('创建三级文件夹被拦截：folder_depth_exceeded', () => {
    seedFolder('p2', null, 1, 'work');
    seedFolder('p2c', 'p2', 2, 'work');
    const res = mockRes();
    createFolder(mockReq({ name: '孙子', parentId: 'p2c' }), res as never);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toBe('folder_depth_exceeded');
  });

  it('父文件夹不存在：parent_not_found', () => {
    const res = mockRes();
    createFolder(mockReq({ name: 'x', parentId: 'nope' }), res as never);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toBe('parent_not_found');
  });
});

describe('deleteFolder（级联删除）', () => {
  it('删除一级文件夹时级联删除后代，笔记 folder_id 置空', () => {
    const A = '00000000-0000-4000-8000-00000000000a';
    const B = '00000000-0000-4000-8000-00000000000b';
    const C = '00000000-0000-4000-8000-00000000000c';
    seedFolder(A, null, 1, 'work');
    seedFolder(B, A, 2, 'work');
    seedFolder(C, B, 3, 'work'); // 仅测试用（API 已禁止三级，但级联需覆盖）
    seedNote('n1', A);
    seedNote('n2', B);

    const res = mockRes();
    deleteFolder(mockReq({}, { id: A }), res as never);
    expect(res.statusCode).toBe(200);

    const remaining = testDb
      .prepare('SELECT id FROM folders WHERE id IN (?, ?, ?)')
      .all(A, B, C) as { id: string }[];
    expect(remaining).toHaveLength(0);

    const notes = testDb.prepare('SELECT id, folder_id FROM notes').all() as {
      id: string;
      folder_id: string | null;
    }[];
    expect(notes.every((n) => n.folder_id === null)).toBe(true);
  });
});

describe('collectDescendantIds', () => {
  it('收集全部后代（不含自身）', () => {
    seedFolder('X', null, 1, 'work');
    seedFolder('Y', 'X', 2, 'work');
    seedFolder('Z', 'Y', 3, 'work');
    const ids = collectDescendantIds(testDb, 'X', 'user-1');
    expect(ids.sort()).toEqual(['Y', 'Z']);
  });
});
