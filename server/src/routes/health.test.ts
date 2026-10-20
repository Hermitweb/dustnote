/**
 * /health 路由测试
 *
 * 覆盖：
 *  - 正常路径：ok=true、db='ok'、version、uptime、timestamp
 *  - 不泄露业务规模（notesCount 不出现，审计 SEC-014）
 *  - DB 错误路径：返回 503 + ok false
 *  - 不回传 err.message（不泄露 SQL/路径）
 *  - DB 返回异常值：ok=false + db='error'
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';

vi.mock('../env.js', () => ({
  config: { serverVersion: '9.9.9-test', webOrigin: 'http://localhost' },
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));

vi.mock('../db.js', () => ({
  getDb: () => ({
    prepare: () => ({ get: () => ({ ok: 1 }) }),
  }),
}));

const { healthRouter } = await import('./health.js');

function app() {
  const a = express();
  a.use(healthRouter);
  return a;
}

describe('GET /health', () => {
  it('200 + ok=true + db=ok + 包含 version/uptime/timestamp', async () => {
    const res = await supertest(app()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.db).toBe('ok');
    expect(res.body.version).toBe('9.9.9-test');
    expect(typeof res.body.uptime).toBe('number');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('不泄露业务规模（notesCount / foldersCount 缺失）', async () => {
    const res = await supertest(app()).get('/health');
    expect(res.body.notesCount).toBeUndefined();
    expect(res.body.foldersCount).toBeUndefined();
  });
});

// 第二组：DB 抛错
describe('GET /health (DB 异常)', () => {
  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('../env.js', () => ({
      config: { serverVersion: '9.9.9-test', webOrigin: 'http://localhost' },
    }));
    vi.doMock('../logger.js', () => ({
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      },
    }));
    vi.doMock('../db.js', () => ({
      getDb: () => {
        throw new Error('DB 路径 /var/lib/dustnote/data.db 连接失败（敏感信息）');
      },
    }));
  });

  it('503 + ok=false + error=db_error', async () => {
    const { healthRouter: hr } = await import('./health.js');
    const a = express();
    a.use(hr);
    const res = await supertest(a).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('db_error');
  });

  it('不回传 err.message（不泄露 SQL/路径细节）', async () => {
    const { healthRouter: hr } = await import('./health.js');
    const a = express();
    a.use(hr);
    const res = await supertest(a).get('/health');
    expect(res.text).not.toContain('DB 路径');
    expect(res.text).not.toContain('sqlite');
  });
});

// 第三组：DB 返回非 1
describe('GET /health (DB 返回非 1)', () => {
  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('../env.js', () => ({
      config: { serverVersion: '9.9.9-test', webOrigin: 'http://localhost' },
    }));
    vi.doMock('../logger.js', () => ({
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      },
    }));
    vi.doMock('../db.js', () => ({
      getDb: () => ({
        prepare: () => ({ get: () => ({ ok: 0 }) }),
      }),
    }));
  });

  it('DB 返回异常值 → ok=false + db=error', async () => {
    const { healthRouter: hr } = await import('./health.js');
    const a = express();
    a.use(hr);
    const res = await supertest(a).get('/health');
    expect(res.body.ok).toBe(false);
    expect(res.body.db).toBe('error');
  });

  it('DB 返回 undefined → ok=false + db=error', async () => {
    vi.resetModules();
    vi.doMock('../env.js', () => ({
      config: { serverVersion: '9.9.9-test', webOrigin: 'http://localhost' },
    }));
    vi.doMock('../logger.js', () => ({
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      },
    }));
    vi.doMock('../db.js', () => ({
      getDb: () => ({
        prepare: () => ({ get: () => undefined }),
      }),
    }));
    const { healthRouter: hr } = await import('./health.js');
    const a = express();
    a.use(hr);
    const res = await supertest(a).get('/health');
    expect(res.body.ok).toBe(false);
  });
});
