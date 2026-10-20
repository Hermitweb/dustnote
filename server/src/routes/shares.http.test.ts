/**
 * sharesRouter HTTP 层（supertest）测试 —— 补 shares.ts 路由 handler 的 16% 缺口
 *
 * 覆盖：POST/GET/DELETE 三条登录用户路由 + 公开访问（password / lockout / 401/410/423/404）。
 * shares.ts 用的 password 是 scrypt 真哈希，单测里 mock 掉以免跑真 scrypt。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express, { type Request } from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { sharesRouter, publicSharesRouter } from './shares.js';

let testDb: DatabaseType;
const USER_ID = 'user-shares';
const DEVICE_ID = 'dev-shares';

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES ('${USER_ID}');
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ciphertext TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE shares (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      ciphertext TEXT NOT NULL,
      wrapped_share_key TEXT NOT NULL,
      password_hash TEXT,
      expires_at TEXT,
      view_count INTEGER NOT NULL DEFAULT 0,
      revoked INTEGER NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT, device_id TEXT, event TEXT NOT NULL,
      ip_hash TEXT, meta TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  vi.mock('../db.js', () => ({ getDb: () => testDb }));
  vi.mock('../services/sync-ws.js', () => ({
    broadcastNoteChanged: () => undefined,
    broadcastShareChanged: () => undefined,
  }));
  vi.mock('../auth/ip-hash.js', () => ({ ipHash: () => 'fake-ip-hash' }));
  // 单测里不让 scrypt 跑——用稳定 mock
  vi.mock('../auth/password.js', () => ({
    hashPassword: async (pwd: string) => `mock-hash:${pwd}`,
    verifyPassword: async (pwd: string, stored: string) => stored === `mock-hash:${pwd}`,
  }));
});

afterAll(() => testDb.close());

beforeEach(() => {
  testDb.exec('DELETE FROM audit_log');
  testDb.exec('DELETE FROM shares');
  testDb.exec('DELETE FROM notes');
});

/** 挂 fake auth 的 app（登录用户路由）。 */
function authedApp() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1', (req: Request, _res, next) => {
    (req as { user?: { userId: string; deviceId: string } }).user = {
      userId: USER_ID,
      deviceId: DEVICE_ID,
    };
    next();
  });
  a.use('/api/v1', sharesRouter);
  return a;
}

/** 公开访问（无 auth）的 app。 */
function publicApp() {
  const a = express();
  a.use(express.json());
  a.use(publicSharesRouter);
  return a;
}

const C = { v: 1, k: 1, n: 'nonce', c: 'ciphertext' };
const W = { v: 1, k: 1, n: 'wnonce', c: 'wkey' };

const NOTE_OK = '11111111-1111-4111-8111-111111111111';
const NOTE_DELETED = '11111111-1111-4111-8111-111111111112';

function seedNote(id: string, deleted: boolean | null = false) {
  testDb
    .prepare(`INSERT INTO notes (id, user_id, ciphertext, deleted_at) VALUES (?, ?, 'c', ?)`)
    .run(id, USER_ID, deleted ? new Date().toISOString() : null);
}

describe('sharesRouter HTTP handlers', () => {
  describe('POST /shares', () => {
    it('201 创建分享（无密码 / 不过期）', async () => {
      seedNote(NOTE_OK);
      const res = await request(authedApp())
        .post('/api/v1/shares')
        .send({ noteId: NOTE_OK, ciphertext: C, wrappedShareKey: W });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
      expect(res.body.url).toBe(`/share/${res.body.token}`);
      expect(res.body.expiresAt).toBeNull();
    });

    it('with password + expiresIn → password_hash 落库 + expiresAt 回写', async () => {
      seedNote(NOTE_OK);
      const res = await request(authedApp()).post('/api/v1/shares').send({
        noteId: NOTE_OK,
        ciphertext: C,
        wrappedShareKey: W,
        password: 'mypwd',
        expiresIn: 3600,
      });
      expect(res.status).toBe(201);
      const row = testDb
        .prepare('SELECT password_hash, expires_at FROM shares WHERE id=?')
        .get(res.body.id) as { password_hash: string; expires_at: string };
      expect(row.password_hash).toBe('mock-hash:mypwd');
      expect(row.expires_at).not.toBeNull();
    });

    it('笔记不存在 → 404', async () => {
      const res = await request(authedApp()).post('/api/v1/shares').send({
        noteId: '00000000-0000-4000-8000-000000000001',
        ciphertext: C,
        wrappedShareKey: W,
      });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('note_not_found');
    });

    it('笔记已软删 → 400 note_deleted', async () => {
      seedNote(NOTE_DELETED, true);
      const res = await request(authedApp())
        .post('/api/v1/shares')
        .send({ noteId: NOTE_DELETED, ciphertext: C, wrappedShareKey: W });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('note_deleted');
    });

    it('非法 body（缺 ciphertext）→ 400 invalid_body', async () => {
      seedNote(NOTE_OK);
      const res = await request(authedApp())
        .post('/api/v1/shares')
        .send({ noteId: NOTE_OK, wrappedShareKey: W });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_body');
    });

    it('幂等重放：同 id 再 POST → 201 且沿用旧 token', async () => {
      seedNote(NOTE_OK);
      const first = await request(authedApp()).post('/api/v1/shares').send({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        noteId: NOTE_OK,
        ciphertext: C,
        wrappedShareKey: W,
      });
      const second = await request(authedApp()).post('/api/v1/shares').send({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        noteId: NOTE_OK,
        ciphertext: C,
        wrappedShareKey: W,
      });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.token).toBe(first.body.token);
    });

    it('审计日志：share_create 写入', async () => {
      seedNote(NOTE_OK);
      const res = await request(authedApp())
        .post('/api/v1/shares')
        .send({ noteId: NOTE_OK, ciphertext: C, wrappedShareKey: W, password: 'longenough' });
      expect(res.status).toBe(201);
      const audit = testDb.prepare('SELECT event FROM audit_log WHERE user_id=?').get(USER_ID) as {
        event: string;
      };
      expect(audit.event).toBe('share_create');
    });
  });

  describe('GET /shares', () => {
    it('返回当前用户全部 share（不返回 ciphertext）', async () => {
      seedNote(NOTE_OK);
      const created = await request(authedApp())
        .post('/api/v1/shares')
        .send({ noteId: NOTE_OK, ciphertext: C, wrappedShareKey: W });
      const res = await request(authedApp()).get('/api/v1/shares');
      expect(res.status).toBe(200);
      expect(res.body.shares.length).toBe(1);
      const s = res.body.shares[0];
      expect(s.id).toBe(created.body.id);
      expect(s.token).toBe(created.body.token);
      expect(s.wrappedShareKey).toEqual(W);
      expect(s.hasPassword).toBe(false);
      expect(s.revoked).toBe(false);
    });
  });

  describe('DELETE /shares/:id', () => {
    it('吊销 + 审计', async () => {
      seedNote(NOTE_OK);
      const created = await request(authedApp())
        .post('/api/v1/shares')
        .send({ noteId: NOTE_OK, ciphertext: C, wrappedShareKey: W });
      const res = await request(authedApp()).delete(`/api/v1/shares/${created.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const row = testDb.prepare('SELECT revoked FROM shares WHERE id=?').get(created.body.id) as {
        revoked: number;
      };
      expect(row.revoked).toBe(1);
      const audit = testDb
        .prepare("SELECT event FROM audit_log WHERE event='share_revoke'")
        .get() as { event: string };
      expect(audit).toBeDefined();
    });

    it('不存在 → 404', async () => {
      const res = await request(authedApp()).delete(
        '/api/v1/shares/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      );
      expect(res.status).toBe(404);
    });
  });

  describe('POST /share/public/:token（公开访问）', () => {
    it('无密码分享 + 正确 body → 返回密文 + view_count+1', async () => {
      seedNote(NOTE_OK);
      const created = await request(authedApp())
        .post('/api/v1/shares')
        .send({ noteId: NOTE_OK, ciphertext: C, wrappedShareKey: W });
      const res = await request(publicApp()).post(`/share/public/${created.body.token}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.ciphertext).toEqual(C);
      expect(res.body.noteId).toBe(NOTE_OK);
      const row = testDb
        .prepare('SELECT view_count FROM shares WHERE id=?')
        .get(created.body.id) as { view_count: number };
      expect(row.view_count).toBe(1);
    });

    it('带密码 + 正确密码 → 200 + 失败计数清零', async () => {
      seedNote(NOTE_OK);
      const created = await request(authedApp())
        .post('/api/v1/shares')
        .send({ noteId: NOTE_OK, ciphertext: C, wrappedShareKey: W, password: 'topsecret' });
      const ok = await request(publicApp())
        .post(`/share/public/${created.body.token}`)
        .send({ password: 'topsecret' });
      expect(ok.status).toBe(200);
      const row = testDb
        .prepare('SELECT failed_attempts FROM shares WHERE id=?')
        .get(created.body.id) as { failed_attempts: number };
      expect(row.failed_attempts).toBe(0);
    });

    it('带密码 + 漏传密码 → 401 password_required', async () => {
      seedNote(NOTE_OK);
      const created = await request(authedApp())
        .post('/api/v1/shares')
        .send({ noteId: NOTE_OK, ciphertext: C, wrappedShareKey: W, password: 'topsecret' });
      const res = await request(publicApp()).post(`/share/public/${created.body.token}`).send({});
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('password_required');
    });

    it('带密码 + 错密码 → 401 invalid_password + 失败计数 +1', async () => {
      seedNote(NOTE_OK);
      const created = await request(authedApp())
        .post('/api/v1/shares')
        .send({ noteId: NOTE_OK, ciphertext: C, wrappedShareKey: W, password: 'topsecret' });
      const res = await request(publicApp())
        .post(`/share/public/${created.body.token}`)
        .send({ password: 'wrong' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_password');
      const row = testDb
        .prepare('SELECT failed_attempts FROM shares WHERE id=?')
        .get(created.body.id) as { failed_attempts: number };
      expect(row.failed_attempts).toBe(1);
    });

    it('token 不存在 → 404', async () => {
      const res = await request(publicApp()).post('/share/public/does-not-exist').send({});
      expect(res.status).toBe(404);
    });

    it('吊销后 → 410 revoked', async () => {
      seedNote(NOTE_OK);
      const created = await request(authedApp())
        .post('/api/v1/shares')
        .send({ noteId: NOTE_OK, ciphertext: C, wrappedShareKey: W });
      await request(authedApp()).delete(`/api/v1/shares/${created.body.id}`);
      const res = await request(publicApp()).post(`/share/public/${created.body.token}`).send({});
      expect(res.status).toBe(410);
      expect(res.body.error).toBe('revoked');
    });

    it('过期后 → 410 expired', async () => {
      seedNote(NOTE_OK);
      const created = await request(authedApp())
        .post('/api/v1/shares')
        .send({ noteId: NOTE_OK, ciphertext: C, wrappedShareKey: W, expiresIn: 1 });
      // 手工把 expires_at 写到过去
      testDb
        .prepare('UPDATE shares SET expires_at = ? WHERE id=?')
        .run('2020-01-01T00:00:00.000Z', created.body.id);
      const res = await request(publicApp()).post(`/share/public/${created.body.token}`).send({});
      expect(res.status).toBe(410);
      expect(res.body.error).toBe('expired');
    });

    it('连续 6 次错密码后下一次访问 → 423 share_locked', async () => {
      seedNote(NOTE_OK);
      const created = await request(authedApp())
        .post('/api/v1/shares')
        .send({ noteId: NOTE_OK, ciphertext: C, wrappedShareKey: W, password: 'topsecret' });
      // 锁是「下一次请求进来时检查」，6 次失败都还是 401，第 7 次起 423
      for (let i = 0; i < 6; i++) {
        const r = await request(publicApp())
          .post(`/share/public/${created.body.token}`)
          .send({ password: 'wrong' });
        expect(r.status).toBe(401);
      }
      // 第 7 次：看到 lockedUntil → 423
      const r7 = await request(publicApp())
        .post(`/share/public/${created.body.token}`)
        .send({ password: 'wrong' });
      expect(r7.status).toBe(423);
      expect(r7.body.error).toBe('share_locked');
    });
  });
});
