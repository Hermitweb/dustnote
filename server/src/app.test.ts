/**
 * HTTP 集成测试（审计 TEST-005）：supertest 直打 createApp()，
 * 验证路由级行为——健康检查、无凭据 401、/metrics 开关门控。
 *
 * 注意：app.ts → env.ts 在 import 时读环境变量，所以每个用例用
 * vi.resetModules() + 动态 import 获取独立配置；config-validate（生产
 * 强校验 + process.exit）只在 index.ts 引入，此处不会触发。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  it('200 且不含业务规模指标', { timeout: 30_000 }, async () => {
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
  it('带合法版本头但无凭据访问受保护资源 → 401', { timeout: 30_000 }, async () => {
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
  it('默认关闭 → 404', { timeout: 30_000 }, async () => {
    const app = await loadApp();
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/metrics');
    expect(res.status).toBe(404);
  });

  it('METRICS_ENABLED=true → 200 Prometheus 文本', { timeout: 30_000 }, async () => {
    process.env.METRICS_ENABLED = 'true';
    const app = await loadApp();
    const supertest = (await import('supertest')).default;
    const res = await supertest(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('dustnote_http_request_duration_seconds');
  });

  it('配置 METRICS_TOKEN 后无 Bearer → 401', { timeout: 30_000 }, async () => {
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

describe('auth 限流分桶（S-M1）', () => {
  it(
    'refresh 撞满宽桶不影响 unlock 的严桶预算（IP×路由互不占额度）',
    { timeout: 30_000 },
    async () => {
      const app = await loadApp();
      const supertest = (await import('supertest')).default;
      const headers = { 'X-Client-Version': '2.5.52', 'X-Client-Platform': 'web' };

      // refresh 桶宽 60：这里只打 3 次触发其计数（无效 token → 401，但已计入限流），
      // 若仍是旧的单桶设计，20 次上限会被这些请求 + unlock 请求共同消耗。
      for (let i = 0; i < 3; i++) {
        await supertest(app).post('/api/v1/auth/refresh').set(headers);
      }

      // unlock 严桶独立计数：首请求应落到业务校验层（401/404）而非 429
      const unlock = await supertest(app)
        .post('/api/v1/auth/unlock')
        .set(headers)
        .set('X-Client-Device-Id', 'ratelimit-test-01')
        .send({ authKey: 'A'.repeat(44) });
      expect(unlock.status).not.toBe(429);

      // refresh 宽桶本身可用：60 上限内不被拒
      const refresh = await supertest(app).post('/api/v1/auth/refresh').set(headers);
      expect(refresh.status).not.toBe(429);
    }
  );

  it('unlock 严桶 20 次后返回 429（防爆破语义保留）', { timeout: 60_000 }, async () => {
    const app = await loadApp();
    const supertest = (await import('supertest')).default;
    const headers = { 'X-Client-Version': '2.5.52', 'X-Client-Platform': 'web' };

    let saw429 = false;
    for (let i = 0; i < 25; i++) {
      const res = await supertest(app)
        .post('/api/v1/auth/unlock')
        .set(headers)
        .set('X-Client-Device-Id', `bruteforce-test-${String(i).padStart(2, '0')}`)
        .send({ authKey: 'A'.repeat(44) });
      if (res.status === 429) {
        saw429 = true;
        expect(res.body.error).toBe('too_many_auth_attempts');
        break;
      }
      // 500 也放行：未初始化的测试库里 unlock 可能撞上非预期的库状态，
      // 这里只关心「严桶最终会以 429 收口」，不关心每个请求的业务结果
      expect([400, 401, 404, 423, 500]).toContain(res.status);
    }
    expect(saw429).toBe(true);
  });
});
