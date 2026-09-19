/**
 * HTTP 集成测试（审计 TEST-005）：supertest 直打 createApp()，
 * 验证路由级行为——健康检查、无凭据 401、/metrics 开关门控。
 *
 * 注意：app.ts → env.ts 在 import 时读环境变量，所以每个用例用
 * vi.resetModules() + 动态 import 获取独立配置；config-validate（生产
 * 强校验 + process.exit）只在 index.ts 引入，此处不会触发。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_DB = './data/app-test.db';

async function loadApp() {
  vi.resetModules();
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = TEST_DB;
  const { createApp } = await import('./app.js');
  return createApp();
}

afterEach(() => {
  delete process.env.METRICS_ENABLED;
  delete process.env.METRICS_TOKEN;
});

describe('GET /api/v1/health', () => {
  it('200 且不含业务规模指标', async () => {
    const app = await loadApp();
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.db).toBe('ok');
    // 审计 SEC-014 关联：健康端点不得泄露笔记/文件夹数量
    expect(res.body.notesCount).toBeUndefined();
  });
});

describe('认证边界', () => {
  it('带合法版本头但无凭据访问受保护资源 → 401', async () => {
    const app = await loadApp();
    const supertest = (await import('supertest')).default;
    // 带上版本头通过 version-check 门禁，落到 authMiddleware 的 401
    const res = await supertest(app)
      .get('/api/v1/notes')
      .set('X-Client-Version', '2.5.40')
      .set('X-Client-Platform', 'web')
      .set('X-Client-Device-Id', 'test-device-0001');
    expect(res.status).toBe(401);
  });
});

describe('/metrics 开关门控（LIFE-009）', () => {
  it('默认关闭 → 404', async () => {
    const app = await loadApp();
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/metrics');
    expect(res.status).toBe(404);
  });

  it('METRICS_ENABLED=true → 200 Prometheus 文本', async () => {
    process.env.METRICS_ENABLED = 'true';
    const app = await loadApp();
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('dustnote_http_request_duration_seconds');
  });

  it('配置 METRICS_TOKEN 后无 Bearer → 401', async () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = 'test-metrics-token-0123456789';
    const app = await loadApp();
    const supertest = (await import('supertest')).default;
    const denied = await supertest(app).get('/metrics');
    expect(denied.status).toBe(401);
    const ok = await supertest(app)
      .get('/metrics')
      .set('Authorization', 'Bearer test-metrics-token-0123456789');
    expect(ok.status).toBe(200);
  });
});
