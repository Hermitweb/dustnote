/**
 * 补齐 account 路由测试
 *
 * 现有 account.test.ts 只覆盖了 2 个用例，本测试补充：
 *  - GET /account/export 完整路径
 *  - DELETE /account confirm 缺失/非 true → 400
 *  - DELETE /account 统计 counts / 清除 audit_log / CASCADE
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import express from 'express';
import supertest from 'supertest';
import { accountRouter } from './account.js';

vi.mock('../env.js', () => ({
  config: {
    serverVersion: '9.9.9-test',
    sentryDsn: undefined,
    nodeEnv: 'test',
    jwtSecret: 'unit-test-secret',
  },
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));

let testDb: DatabaseType;

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      pw_salt BLOB, rc_salt BLOB,
      wrapped_master_key TEXT, wrapped_master_key_pw TEXT, wrapped_master_key_rc TEXT,
      kdf_version INTEGER, kdf_params TEXT, recovery_code_set INTEGER,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT, platform TEXT, fingerprint TEXT,
      last_active_at TEXT, created_at TEXT
    );
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ciphertext TEXT, key_version INTEGER,
      is_pinned INTEGER, is_favorite INTEGER, deleted_at TEXT, version INTEGER,
      client_updated_at TEXT, server_updated_at TEXT, folder_id TEXT
    );
    CREATE TABLE note_versions (
      id TEXT PRIMARY KEY,
      note_id TEXT, user_id TEXT,
      ciphertext TEXT, key_version INTEGER, note_version INTEGER,
      client_updated_at TEXT, created_at TEXT
    );
    CREATE TABLE folders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT, parent_id TEXT, icon TEXT, sort_order INTEGER, created_at TEXT
    );
    CREATE TABLE tags (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT, color TEXT
    );
    CREATE TABLE note_tags (note_id TEXT, tag_id TEXT);
    CREATE TABLE shares (
      id TEXT PRIMARY KEY,
      note_id TEXT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT, ciphertext TEXT, wrapped_share_key TEXT, password_hash TEXT,
      expires_at TEXT, view_count INTEGER, revoked INTEGER, created_at TEXT
    );
    CREATE TABLE preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT, mode TEXT, font TEXT, density TEXT, auto_lock INTEGER, language TEXT, updated_at TEXT
    );
    CREATE TABLE templates (
      id TEXT PRIMARY KEY,
      user_id TEXT, name TEXT, description TEXT, category TEXT, icon TEXT, content TEXT,
      is_preset INTEGER, sort_order INTEGER, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT, device_id TEXT, event TEXT, ip_hash TEXT, meta TEXT, created_at TEXT
    );
  `);
  testDb.exec(
    "INSERT INTO users (id, pw_salt, rc_salt, wrapped_master_key, wrapped_master_key_pw, wrapped_master_key_rc, kdf_version, kdf_params, recovery_code_set, created_at, updated_at) VALUES ('u-1', X'01', X'02', 'wmk', 'pw', 'rc', 1, '{}', 0, '2026-01-01', '2026-01-01')"
  );
  vi.mock('../db.js', () => ({ getDb: () => testDb }));
});

beforeEach(() => {
  testDb.exec('DELETE FROM audit_log');
  testDb.exec('DELETE FROM note_tags');
  testDb.exec("DELETE FROM devices WHERE user_id != 'keep'");
});

function app(user: { userId: string } | null = { userId: 'u-1' }) {
  const a = express();
  a.use(express.json());
  if (user)
    a.use((req: any, _res: any, next: any) => {
      req.user = user;
      next();
    });
  a.use(accountRouter);
  return a;
}

describe('GET /api/v1/account/export', () => {
  it('空账户 → 200', async () => {
    const res = await supertest(app()).get('/account/export');
    expect(res.status).toBe(200);
    expect(res.body.schemaVersion).toBe(1);
    expect(res.body.user.id).toBe('u-1');
    expect(res.body.devices).toEqual([]);
    expect(res.body.notes).toEqual([]);
  });

  it('不导出 password_hash 等敏感凭据字段', async () => {
    const res = await supertest(app()).get('/account/export');
    const userKeys = Object.keys(res.body.user);
    expect(userKeys).not.toContain('password_hash');
    expect(userKeys).not.toContain('master_salt');
    expect(userKeys).not.toContain('recovery_hash');
    expect(userKeys).not.toContain('recovery_salt');
    expect(userKeys).toContain('pw_salt');
    expect(userKeys).toContain('rc_salt');
  });

  it('Content-Disposition 含日期', async () => {
    const res = await supertest(app()).get('/account/export');
    expect(res.headers['content-disposition']).toMatch(
      /dustnote-account-u-1-\d{4}-\d{2}-\d{2}\.json/
    );
  });
});

describe('DELETE /api/v1/account', () => {
  it('confirm 缺失 → 400', async () => {
    const res = await supertest(app()).delete('/account').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });

  it('confirm=false → 400', async () => {
    const res = await supertest(app()).delete('/account').send({ confirm: false });
    expect(res.status).toBe(400);
  });

  it('confirm=true + 级联删除 + audit_log 去标识化', async () => {
    testDb.exec(`INSERT INTO notes (id, user_id, ciphertext, client_updated_at, server_updated_at) VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','u-1','{}','2026-01-01','2026-01-01')`);
    testDb.exec(`INSERT INTO audit_log (user_id, event) VALUES ('u-1', 'login')`);
    const res = await supertest(app()).delete('/account').send({ confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.counts.notes).toBeGreaterThanOrEqual(1);
    // user 已删除
    const u = testDb.prepare('SELECT * FROM users WHERE id = ?').get('u-1');
    expect(u).toBeUndefined();
    // 级联：notes 也消失
    const n = testDb.prepare('SELECT * FROM notes WHERE user_id = ?').get('u-1');
    expect(n).toBeUndefined();
    // audit_log 中 user_id 已被置 NULL（保留事件用于合规）
    const audit = testDb
      .prepare('SELECT user_id FROM audit_log WHERE event = ?')
      .get('login') as any;
    expect(audit.user_id).toBeNull();
  });
});
