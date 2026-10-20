/**
 * 设备管理路由测试
 *
 * 验证：
 *  - GET /devices 列出当前用户所有设备，标记 isCurrent / fingerprintSuffix
 *  - DELETE /devices/:id 吊销指定设备（清 refresh_token_hash）
 *    · 非法 UUID → 400
 *    · 不属于自己的设备 → 404
 *    · 当前设备 → 400 cannot_revoke_current_device
 *  - DELETE /devices 吊销除当前设备外的所有
 *  - 审计日志 device_revoke / device_revoke_others 落库
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import express from 'express';
import supertest from 'supertest';
import { devicesRouter } from './devices.js';

let testDb: DatabaseType;

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      pw_salt BLOB NOT NULL,
      master_salt BLOB NOT NULL,
      password_hash BLOB NOT NULL,
      recovery_hash BLOB NOT NULL,
      recovery_salt BLOB NOT NULL,
      wrapped_master_key TEXT NOT NULL,
      kdf_version INTEGER NOT NULL DEFAULT 1,
      kdf_params TEXT NOT NULL,
      recovery_code_set INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('web','desktop','android','ios','miniprogram')),
      fingerprint TEXT NOT NULL,
      refresh_token_hash TEXT,
      last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      device_id TEXT,
      event TEXT NOT NULL,
      ip_hash TEXT,
      meta TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  testDb
    .prepare(
      'INSERT INTO users (id, pw_salt, master_salt, password_hash, recovery_hash, recovery_salt, wrapped_master_key, kdf_params) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      'user-1',
      Buffer.from([1]),
      Buffer.from([2]),
      Buffer.from([3]),
      Buffer.from([4]),
      Buffer.from([5]),
      '{}',
      '{}'
    );
  vi.mock('../db.js', () => ({ getDb: () => testDb }));
  // 跳过 sync-ws 等非必要副作用
  vi.mock('../services/sync-ws.js', () => ({ broadcastNoteChanged: () => undefined }));
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
  testDb.exec('DELETE FROM devices');
  testDb.exec('DELETE FROM audit_log');
});

const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UUID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function seedDevices() {
  const now = new Date().toISOString();
  testDb
    .prepare(
      'INSERT INTO devices (id, user_id, name, platform, fingerprint, refresh_token_hash, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(UUID_A, 'user-1', 'My Web', 'web', 'abc123def456', 'hash-a', now);
  testDb
    .prepare(
      'INSERT INTO devices (id, user_id, name, platform, fingerprint, refresh_token_hash, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(UUID_B, 'user-1', 'iPhone', 'ios', 'fpr-b', 'hash-b', now);
  testDb
    .prepare(
      'INSERT INTO devices (id, user_id, name, platform, fingerprint, refresh_token_hash, last_active_at) VALUES (?, ?, ?, ?, ?, NULL, ?)'
    )
    .run(UUID_C, 'user-1', 'Revoked', 'android', 'fpr-c', now);
}

describe('GET /api/v1/devices', () => {
  it('列出当前用户所有设备', async () => {
    seedDevices();
    const app = express();
    app.use((req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1', deviceId: UUID_A };
      next();
    });
    app.use(devicesRouter);
    const res = await supertest(app).get('/devices');
    expect(res.status).toBe(200);
    expect(res.body.devices).toHaveLength(3);
    expect(res.body.devices[0]).toMatchObject({
      id: expect.any(String),
      isCurrent: expect.any(Boolean),
      fingerprintSuffix: expect.any(String),
      hasRefreshToken: expect.any(Boolean),
    });
  });

  it('正确标记 isCurrent（设备 ID 与会话相同）', async () => {
    seedDevices();
    const app = express();
    app.use((req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1', deviceId: UUID_A };
      next();
    });
    app.use(devicesRouter);
    const res = await supertest(app).get('/devices');
    const mine = res.body.devices.find((d: any) => d.id === UUID_A);
    expect(mine.isCurrent).toBe(true);
    const other = res.body.devices.find((d: any) => d.id === UUID_B);
    expect(other.isCurrent).toBe(false);
  });

  it('正确返回 fingerprintSuffix 末 4 位', async () => {
    seedDevices();
    const app = express();
    app.use((req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1', deviceId: UUID_A };
      next();
    });
    app.use(devicesRouter);
    const res = await supertest(app).get('/devices');
    const a = res.body.devices.find((d: any) => d.id === UUID_A);
    expect(a.fingerprintSuffix).toBe('f456');
  });

  it('hasRefreshToken 在 refresh_token_hash 为 null 时为 false', async () => {
    seedDevices();
    const app = express();
    app.use((req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1', deviceId: UUID_A };
      next();
    });
    app.use(devicesRouter);
    const res = await supertest(app).get('/devices');
    const c = res.body.devices.find((d: any) => d.id === UUID_C);
    expect(c.hasRefreshToken).toBe(false);
  });
});

describe('DELETE /api/v1/devices/:id', () => {
  it('非法 UUID → 400 invalid_id', async () => {
    const app = express();
    app.use((req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1', deviceId: UUID_A };
      next();
    });
    app.use(devicesRouter);
    const res = await supertest(app).delete('/devices/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_id');
  });

  it('设备不存在 → 404', async () => {
    const app = express();
    app.use((req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1', deviceId: UUID_A };
      next();
    });
    app.use(devicesRouter);
    const res = await supertest(app).delete(`/devices/${UUID_B}`);
    expect(res.status).toBe(404);
  });

  it('吊销当前设备 → 400 cannot_revoke_current_device', async () => {
    seedDevices();
    const app = express();
    app.use((req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1', deviceId: UUID_A };
      next();
    });
    app.use(devicesRouter);
    const res = await supertest(app).delete(`/devices/${UUID_A}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('cannot_revoke_current_device');
  });

  it('吊销其他设备成功 → 清 refresh_token_hash + 写审计', async () => {
    seedDevices();
    const app = express();
    app.use((req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1', deviceId: UUID_A };
      next();
    });
    app.use(devicesRouter);
    const res = await supertest(app).delete(`/devices/${UUID_B}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const row = testDb
      .prepare('SELECT refresh_token_hash FROM devices WHERE id = ?')
      .get(UUID_B) as { refresh_token_hash: string | null };
    expect(row.refresh_token_hash).toBeNull();
    const audit = testDb
      .prepare('SELECT event FROM audit_log WHERE event = ?')
      .get('device_revoke');
    expect(audit).toBeDefined();
  });
});

describe('DELETE /api/v1/devices（吊销其他）', () => {
  it('只吊销非当前设备 + 已有 refresh_token_hash 的设备', async () => {
    seedDevices();
    const app = express();
    app.use((req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1', deviceId: UUID_A };
      next();
    });
    app.use(devicesRouter);
    const res = await supertest(app).delete('/devices');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // UUID_A 是当前设备，UUID_C 已无 refresh_token_hash，只有 UUID_B 应被吊销
    expect(res.body.revokedCount).toBe(1);
    const a = testDb
      .prepare('SELECT refresh_token_hash FROM devices WHERE id = ?')
      .get(UUID_A) as any;
    const b = testDb
      .prepare('SELECT refresh_token_hash FROM devices WHERE id = ?')
      .get(UUID_B) as any;
    const c = testDb
      .prepare('SELECT refresh_token_hash FROM devices WHERE id = ?')
      .get(UUID_C) as any;
    expect(a.refresh_token_hash).toBe('hash-a'); // 当前设备未动
    expect(b.refresh_token_hash).toBeNull();
    expect(c.refresh_token_hash).toBeNull();
  });

  it('无 refresh_token_hash 的设备不计 revokedCount', async () => {
    // 仅插入一个无 refresh_token 的非当前设备
    testDb
      .prepare(
        'INSERT INTO devices (id, user_id, name, platform, fingerprint, refresh_token_hash) VALUES (?, ?, ?, ?, ?, NULL)'
      )
      .run(UUID_B, 'user-1', 'X', 'web', 'fpr-b');
    const app = express();
    app.use((req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1', deviceId: UUID_A };
      next();
    });
    app.use(devicesRouter);
    const res = await supertest(app).delete('/devices');
    expect(res.body.revokedCount).toBe(0);
  });
});
