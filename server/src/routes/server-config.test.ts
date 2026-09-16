/**
 * server-config 路由数据层单元测试（小程序部署引导的地址登记端点）
 *
 * 覆盖：
 * - GET：未登记返回 null / 登记后返回该值 / SERVER_PUBLIC_URL 运维覆盖优先
 * - POST：合法地址写入（去尾斜杠）/ 同值幂等 / 不同值 409 / 非法地址 400
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

// vi.mock 工厂会被提升到文件顶部,引用的变量必须经 vi.hoisted 创建
const { envState } = vi.hoisted(() => ({
  envState: { serverPublicUrl: null as string | null },
}));

let testDb: DatabaseType;

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

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.exec(`
    CREATE TABLE server_config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  vi.mock('../db.js', () => ({
    getDb: () => testDb,
  }));
  vi.mock('../env.js', () => ({
    config: envState,
  }));
});

afterAll(() => {
  testDb.close();
});

beforeEach(() => {
  // 用例间隔离：清空登记表 + 复位运维覆盖
  testDb.prepare('DELETE FROM server_config').run();
  envState.serverPublicUrl = null;
});

// 必须在 vi.mock 之后导入，才能拿到 mock 后的 getDb / config
import { getServerEndpoint, postServerEndpoint } from './server-config.js';

describe('GET /config/server-endpoint', () => {
  it('未登记时返回 null', () => {
    const res = mockRes();
    getServerEndpoint({} as never, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ serverUrl: null });
  });

  it('登记后返回登记值', () => {
    postServerEndpoint({ body: { serverUrl: 'http://10.0.0.5:3210/' } } as never, mockRes());
    const res = mockRes();
    getServerEndpoint({} as never, res);
    expect(res.body).toEqual({ serverUrl: 'http://10.0.0.5:3210' });
  });

  it('SERVER_PUBLIC_URL 运维覆盖优先于登记值', () => {
    envState.serverPublicUrl = 'https://new-host.example';
    const res = mockRes();
    getServerEndpoint({} as never, res);
    expect(res.body).toEqual({ serverUrl: 'https://new-host.example' });
    envState.serverPublicUrl = null;
  });
});

describe('POST /config/server-endpoint', () => {
  it('首次登记写入并去尾斜杠', () => {
    const res = mockRes();
    postServerEndpoint({ body: { serverUrl: 'http://a.example:8080///' } } as never, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ serverUrl: 'http://a.example:8080' });
  });

  it('同值重复登记幂等（不 409）', () => {
    const res = mockRes();
    postServerEndpoint({ body: { serverUrl: 'http://a.example:8080' } } as never, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ serverUrl: 'http://a.example:8080' });
  });

  it('已登记且不同值 → 409 并带出当前值（先到先得,不可改写）', () => {
    postServerEndpoint({ body: { serverUrl: 'http://a.example:8080' } } as never, mockRes());
    const res = mockRes();
    postServerEndpoint({ body: { serverUrl: 'https://evil.example' } } as never, res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'endpoint_already_set', current: 'http://a.example:8080' });
  });

  it('非法地址（缺协议）→ 400', () => {
    const res = mockRes();
    postServerEndpoint({ body: { serverUrl: 'a.example' } } as never, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toBe('invalid_input');
  });

  it('缺失字段 → 400', () => {
    const res = mockRes();
    postServerEndpoint({ body: {} } as never, res);
    expect(res.statusCode).toBe(400);
  });
});
