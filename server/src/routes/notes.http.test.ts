/**
 * notesRouter HTTP 层（supertest）测试 —— 补 notes.ts 路由 handler 的 9.8% 缺口
 *
 * 与 notes.test.ts（DB 层直测）互补：这里把 notesRouter 挂在 express + fake
 * auth 中间件上，走真实 HTTP，覆盖 handler 的分支：
 * 400/404/409、幂等重放、folderId 属主归一、软删/恢复/永久删除、历史版本列表/恢复。
 *
 * getDb / broadcastNoteChanged 用内存 better-sqlite3 + mock 注入，
 * auth 用 fake req.user 注入（绕开真实 JWT 校验）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express, { type Request } from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { notesRouter } from './notes.js';

let testDb: DatabaseType;
const USER_ID = 'user-http';
const DEVICE_ID = 'dev-http';

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES ('${USER_ID}');
    CREATE TABLE folders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL
    );
    CREATE TABLE notes (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ciphertext      BLOB NOT NULL,
      nonce           BLOB,
      key_version     INTEGER NOT NULL DEFAULT 1,
      is_pinned       INTEGER NOT NULL DEFAULT 0,
      is_favorite     INTEGER NOT NULL DEFAULT 0,
      deleted_at      TEXT,
      version         INTEGER NOT NULL DEFAULT 1,
      client_updated_at TEXT NOT NULL,
      server_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      folder_id       TEXT
    );
    CREATE TABLE note_versions (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ciphertext BLOB,
      key_version INTEGER NOT NULL DEFAULT 1,
      note_version INTEGER NOT NULL,
      client_updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE shares (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      ciphertext TEXT NOT NULL,
      wrapped_share_key TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT, device_id TEXT, event TEXT NOT NULL, ip_hash TEXT, meta TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // 种子：两个文件夹（属于 user-http）
  testDb
    .prepare('INSERT INTO folders (id, user_id, name) VALUES (?, ?, ?)')
    .run('folder-a', USER_ID, 'A');
  testDb
    .prepare('INSERT INTO folders (id, user_id, name) VALUES (?, ?, ?)')
    .run('folder-b', USER_ID, 'B');

  vi.mock('../db.js', () => ({ getDb: () => testDb }));
  vi.mock('../services/sync-ws.js', () => ({ broadcastNoteChanged: () => undefined }));
  // ipHash(req) 在永久删除审计里用；mock 掉避免读真实 socket 头
  vi.mock('../auth/ip-hash.js', () => ({ ipHash: () => 'fake-ip-hash' }));
});

afterAll(() => testDb.close());

beforeEach(() => {
  testDb.exec('DELETE FROM note_versions');
  testDb.exec('DELETE FROM shares');
  testDb.exec('DELETE FROM notes');
});

/** 造一个挂 fake auth 的 app：req.user 固定为当前用户。 */
function app() {
  const a = express();
  a.use(express.json());
  // fake auth：直接注入 req.user（绕开真实 JWT）
  a.use('/api/v1', (req: Request, _res, next) => {
    (req as { user?: { userId: string; deviceId: string } }).user = {
      userId: USER_ID,
      deviceId: DEVICE_ID,
    };
    next();
  });
  a.use('/api/v1', notesRouter);
  return a;
}

const NOW = () => new Date().toISOString();

/** 合法 UUID（路由 UUID_RE 校验）。 */
const U = {
  single1: '11111111-1111-4111-8111-111111111111',
  single404: '11111111-1111-4111-8111-999999999999',
  patch1: '22222222-2222-4222-8222-222222222222',
  patch2: '22222222-2222-4222-8222-222222222223',
  patch3: '22222222-2222-4222-8222-222222222224',
  patch4: '22222222-2222-4222-8222-222222222225',
  patch404: '22222222-2222-4222-8222-999999999999',
  del1: '33333333-3333-4333-8333-333333333333',
  del2: '33333333-3333-4333-8333-333333333334',
  del404: '33333333-3333-4333-8333-999999999999',
  perm1: '44444444-4444-4444-8444-444444444444',
  perm404: '44444444-4444-4444-8444-999999999999',
  ver1: '55555555-5555-4555-8555-555555555555',
  ver1s1: '55555555-5555-4555-8555-555555555501',
  ver2: '55555555-5555-4555-8555-555555555556',
  ver2s1: '55555555-5555-4555-8555-555555555502',
  ver3: '55555555-5555-4555-8555-555555555557',
  rest1: '66666666-6666-4666-8666-666666666666',
  rest1s1: '66666666-6666-4666-8666-666666666601',
  rest2: '66666666-6666-4666-8666-666666666667',
  rest2s1: '66666666-6666-4666-8666-666666666602',
};

describe('notesRouter HTTP handlers', () => {
  describe('POST /notes', () => {
    it('201 创建新笔记（默认 id + version 1）', async () => {
      const res = await request(app())
        .post('/api/v1/notes')
        .send({ ciphertext: 'cipher-v1', clientUpdatedAt: NOW() });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.version).toBe(1);
      expect(res.body.replay).toBeUndefined();
    });

    it('幂等重放：同 id 再 POST → 200 + replay=true', async () => {
      const id = '00000000-0000-4000-8000-000000000001';
      const first = await request(app())
        .post('/api/v1/notes')
        .send({ id, ciphertext: 'c1', clientUpdatedAt: NOW() });
      expect(first.status).toBe(201);
      const replay = await request(app())
        .post('/api/v1/notes')
        .send({ id, ciphertext: 'c2', clientUpdatedAt: NOW() });
      expect(replay.status).toBe(200);
      expect(replay.body.replay).toBe(true);
      expect(replay.body.version).toBe(1);
    });

    it('跨用户 id 撞车 → 409', async () => {
      const id = '00000000-0000-4000-8000-000000000002';
      // 先建 other-user（users 表）再占用该 id，避免 FK 拦
      testDb.prepare('INSERT OR IGNORE INTO users (id) VALUES (?)').run('other-user');
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, version, server_updated_at)
           VALUES (?, 'other-user', 'x', ?, 1, ?)`
        )
        .run(id, NOW(), NOW());
      const res = await request(app())
        .post('/api/v1/notes')
        .send({ id, ciphertext: 'mine', clientUpdatedAt: NOW() });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('id_conflict');
    });

    it('非法 body（缺 clientUpdatedAt）→ 400 invalid_body', async () => {
      const res = await request(app()).post('/api/v1/notes').send({ ciphertext: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_body');
    });

    it('folderId 非法（不属于当前用户）→ 归一为 null，笔记仍创建', async () => {
      const res = await request(app())
        .post('/api/v1/notes')
        .send({ ciphertext: 'x', clientUpdatedAt: NOW(), folderId: 'not-mine' });
      expect(res.status).toBe(201);
      expect(res.body.folderId).toBeNull();
    });

    it('folderId 属于当前用户 → 保留', async () => {
      const res = await request(app())
        .post('/api/v1/notes')
        .send({ ciphertext: 'x', clientUpdatedAt: NOW(), folderId: 'folder-a' });
      expect(res.status).toBe(201);
      expect(res.body.folderId).toBe('folder-a');
    });
  });

  describe('GET /notes', () => {
    it('列出笔记 + hasMore/nextCursor 结构', async () => {
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, version, server_updated_at)
           VALUES (?, ?, 'c', ?, 1, ?)`
        )
        .run('list-1', USER_ID, NOW(), NOW());
      const res = await request(app()).get('/api/v1/notes');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.notes)).toBe(true);
      expect(res.body.notes[0].id).toBe('list-1');
      expect(res.body.hasMore).toBe(false);
    });

    it('非法 since → 400 invalid_since', async () => {
      const res = await request(app()).get('/api/v1/notes?since=garbage');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_since');
    });

    it('非法 cursor → 400 invalid_cursor', async () => {
      const res = await request(app()).get('/api/v1/notes?cursor=garbage');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_cursor');
    });
  });

  describe('GET /notes/:id', () => {
    it('命中 → 返回笔记', async () => {
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, version, server_updated_at)
           VALUES (?, ?, 'c', ?, 1, ?)`
        )
        .run(U.single1, USER_ID, NOW(), NOW());
      const res = await request(app()).get(`/api/v1/notes/${U.single1}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(U.single1);
    });

    it('非 UUID → 400', async () => {
      const res = await request(app()).get('/api/v1/notes/not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('missing_id');
    });

    it('不存在 → 404', async () => {
      const res = await request(app()).get(`/api/v1/notes/${U.single404}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /notes/:id', () => {
    function seedNote(id: string, version = 1, folderId: string | null = null) {
      testDb
        .prepare(
          `INSERT INTO notes (id, user_id, ciphertext, client_updated_at, version, server_updated_at, folder_id)
           VALUES (?, ?, 'old', ?, ?, ?, ?)`
        )
        .run(id, USER_ID, NOW(), version, NOW(), folderId);
    }

    it('乐观锁成功 → version+1，密文快照进 note_versions', async () => {
      const id = U.patch1;
      seedNote(id, 1);
      const res = await request(app())
        .patch(`/api/v1/notes/${id}`)
        .send({ ciphertext: 'new', version: 1, clientUpdatedAt: NOW() });
      expect(res.status).toBe(200);
      expect(res.body.version).toBe(2);
      // 快照：note_versions 多了一行旧密文
      const snap = testDb
        .prepare('SELECT ciphertext FROM note_versions WHERE note_id = ?')
        .get(id) as { ciphertext: string | Buffer };
      expect(String(snap.ciphertext)).toBe('old');
    });

    it('version 不匹配 → 409 version_mismatch', async () => {
      const id = U.patch2;
      seedNote(id, 3);
      const res = await request(app())
        .patch(`/api/v1/notes/${id}`)
        .send({ ciphertext: 'new', version: 1, clientUpdatedAt: NOW() });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('version_mismatch');
      expect(res.body.current.version).toBe(3);
    });

    it('笔记不存在 → 404', async () => {
      const res = await request(app())
        .patch(`/api/v1/notes/${U.patch404}`)
        .send({ version: 1, clientUpdatedAt: NOW() });
      expect(res.status).toBe(404);
    });

    it('PATCH folderId 非法 → 归一为 null（回传生效值）', async () => {
      const id = U.patch3;
      seedNote(id, 1, 'folder-a');
      const res = await request(app())
        .patch(`/api/v1/notes/${id}`)
        .send({ version: 1, clientUpdatedAt: NOW(), folderId: 'not-mine' });
      expect(res.status).toBe(200);
      expect(res.body.folderId).toBeNull();
    });

    it('软删除（deletedAt 设置）→ version+1', async () => {
      const id = U.patch4;
      seedNote(id, 1);
      const res = await request(app())
        .patch(`/api/v1/notes/${id}`)
        .send({ version: 1, clientUpdatedAt: NOW(), deletedAt: NOW() });
      expect(res.status).toBe(200);
      // notes 行有 deleted_at + version 自增
      const noteRow = testDb
        .prepare('SELECT deleted_at, version FROM notes WHERE id=?')
        .get(id) as { deleted_at: string | null; version: number };
      expect(noteRow.deleted_at).not.toBeNull();
      expect(noteRow.version).toBe(2);
    });
  });

  describe('DELETE /notes/:id（软删）', () => {
    it('软删成功 → ok + 级联吊销分享', async () => {
      testDb
        .prepare(
          'INSERT INTO notes (id, user_id, ciphertext, client_updated_at, version, server_updated_at) VALUES (?,?,?,?,1,?)'
        )
        .run(U.del1, USER_ID, 'c', NOW(), NOW());
      testDb
        .prepare(
          'INSERT INTO shares (id, note_id, user_id, token, ciphertext, wrapped_share_key) VALUES (?,?,?,?,?,?)'
        )
        .run('sh-del', U.del1, USER_ID, 'tok', 'c', 'k');
      const res = await request(app()).delete(`/api/v1/notes/${U.del1}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const s = testDb.prepare('SELECT revoked FROM shares WHERE id=?').get('sh-del') as {
        revoked: number;
      };
      expect(s.revoked).toBe(1);
    });

    it('重复软删 → 200 alreadyDeleted（幂等）', async () => {
      testDb
        .prepare(
          'INSERT INTO notes (id, user_id, ciphertext, client_updated_at, version, server_updated_at, deleted_at) VALUES (?,?,?,?,1,?,?)'
        )
        .run(U.del2, USER_ID, 'c', NOW(), NOW(), NOW());
      const res = await request(app()).delete(`/api/v1/notes/${U.del2}`);
      expect(res.status).toBe(200);
      expect(res.body.alreadyDeleted).toBe(true);
    });

    it('非 UUID → 400', async () => {
      const res = await request(app()).delete('/api/v1/notes/bad-id');
      expect(res.status).toBe(400);
    });

    it('不存在 → 404', async () => {
      const res = await request(app()).delete(`/api/v1/notes/${U.del404}`);
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /notes/:id/permanent', () => {
    it('永久删除 → 行消失 + audit_log 写入', async () => {
      testDb
        .prepare(
          'INSERT INTO notes (id, user_id, ciphertext, client_updated_at, version, server_updated_at) VALUES (?,?,?,?,1,?)'
        )
        .run(U.perm1, USER_ID, 'c', NOW(), NOW());
      const res = await request(app()).delete(`/api/v1/notes/${U.perm1}/permanent`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const row = testDb.prepare('SELECT 1 FROM notes WHERE id=?').get(U.perm1);
      expect(row).toBeUndefined();
      const audit = testDb.prepare('SELECT event FROM audit_log WHERE user_id=?').get(USER_ID) as {
        event: string;
      };
      expect(audit.event).toBe('note_permanent_delete');
    });

    it('不存在 → 404', async () => {
      const res = await request(app()).delete(`/api/v1/notes/${U.perm404}/permanent`);
      expect(res.status).toBe(404);
    });
  });

  describe('历史版本', () => {
    it('GET /notes/:id/versions 列出快照', async () => {
      testDb
        .prepare(
          'INSERT INTO notes (id, user_id, ciphertext, client_updated_at, version, server_updated_at) VALUES (?,?,?,?,1,?)'
        )
        .run(U.ver1, USER_ID, 'c', NOW(), NOW());
      testDb
        .prepare(
          'INSERT INTO note_versions (id, note_id, user_id, ciphertext, key_version, note_version, client_updated_at) VALUES (?,?,?,?,?,?,?)'
        )
        .run(U.ver1s1, U.ver1, USER_ID, 'old-cipher', 1, 1, NOW());
      const res = await request(app()).get(`/api/v1/notes/${U.ver1}/versions`);
      expect(res.status).toBe(200);
      expect(res.body.versions.length).toBe(1);
      expect(res.body.versions[0].noteVersion).toBe(1);
    });

    it('GET /notes/:id/versions/:versionId 命中', async () => {
      testDb
        .prepare(
          'INSERT INTO notes (id, user_id, ciphertext, client_updated_at, version, server_updated_at) VALUES (?,?,?,?,1,?)'
        )
        .run(U.ver2, USER_ID, 'c', NOW(), NOW());
      testDb
        .prepare(
          'INSERT INTO note_versions (id, note_id, user_id, ciphertext, key_version, note_version, client_updated_at) VALUES (?,?,?,?,?,?,?)'
        )
        .run(U.ver2s1, U.ver2, USER_ID, 'old', 1, 1, NOW());
      const res = await request(app()).get(`/api/v1/notes/${U.ver2}/versions/${U.ver2s1}`);
      expect(res.status).toBe(200);
      expect(res.body.noteVersion).toBe(1);
    });

    it('版本不存在 → 404', async () => {
      testDb
        .prepare(
          'INSERT INTO notes (id, user_id, ciphertext, client_updated_at, version, server_updated_at) VALUES (?,?,?,?,1,?)'
        )
        .run(U.ver3, USER_ID, 'c', NOW(), NOW());
      // 合法 UUID 但库里没有该快照 → 404（区别于非法 versionId 的 400）
      const missingVer = '55555555-5555-4555-8555-777777777777';
      const res = await request(app()).get(`/api/v1/notes/${U.ver3}/versions/${missingVer}`);
      expect(res.status).toBe(404);
    });

    it('POST restore 恢复历史版本 → version+1', async () => {
      testDb
        .prepare(
          'INSERT INTO notes (id, user_id, ciphertext, client_updated_at, version, server_updated_at) VALUES (?,?,?,?,1,?)'
        )
        .run(U.rest1, USER_ID, 'current', NOW(), NOW());
      testDb
        .prepare(
          'INSERT INTO note_versions (id, note_id, user_id, ciphertext, key_version, note_version, client_updated_at) VALUES (?,?,?,?,?,?,?)'
        )
        .run(U.rest1s1, U.rest1, USER_ID, 'historical', 1, 1, NOW());
      const res = await request(app())
        .post(`/api/v1/notes/${U.rest1}/versions/${U.rest1s1}/restore`)
        .send({ version: 1, clientUpdatedAt: NOW() });
      expect(res.status).toBe(200);
      expect(res.body.version).toBe(2);
      const row = testDb.prepare('SELECT ciphertext FROM notes WHERE id=?').get(U.rest1) as {
        ciphertext: string | Buffer;
      };
      expect(String(row.ciphertext)).toBe('historical');
    });

    it('restore version 不匹配 → 409', async () => {
      testDb
        .prepare(
          'INSERT INTO notes (id, user_id, ciphertext, client_updated_at, version, server_updated_at) VALUES (?,?,?,?,5,?)'
        )
        .run(U.rest2, USER_ID, 'c', NOW(), NOW());
      testDb
        .prepare(
          'INSERT INTO note_versions (id, note_id, user_id, ciphertext, key_version, note_version, client_updated_at) VALUES (?,?,?,?,?,?,?)'
        )
        .run(U.rest2s1, U.rest2, USER_ID, 'old', 1, 1, NOW());
      const res = await request(app())
        .post(`/api/v1/notes/${U.rest2}/versions/${U.rest2s1}/restore`)
        .send({ version: 1, clientUpdatedAt: NOW() });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('version_mismatch');
    });
  });
});
