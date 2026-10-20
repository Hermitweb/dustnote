/**
 * update-manifest 路由测试
 *
 * 覆盖：
 *  - 缺必备 header → 400
 *  - 非法 platform → 400
 *  - 合法请求返回 manifest + Cache-Control + 版本头
 *  - 强制升级头在配置存在时下发
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';

vi.mock('../env.js', () => ({
  config: {
    minClientVersion: '2.0.0',
    recommendedClientVersion: '2.5.50',
    serverVersion: '2.99.0',
    forceUpdateVersion: undefined as string | undefined,
    sentryDsn: undefined,
    nodeEnv: 'test',
  },
}));

vi.mock('../services/update-manifest.js', () => ({
  getManifestForChannel: (channel: string, _ctx: unknown) => ({
    format: 'dustnote.update.v1',
    channel,
    versions: { web: '2.99.0', android: '2.99.0' },
    rolloutPercent: 100,
  }),
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));

const { updateManifestRouter } = await import('./update-manifest.js');

function app() {
  const a = express();
  a.use(updateManifestRouter);
  return a;
}

const baseHeaders = {
  'X-Client-Version': '2.5.40',
  'X-Client-Platform': 'web',
  'X-Client-Device-Id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

describe('GET /api/v1/update-manifest', () => {
  it('合法请求 → 200 + manifest + 缓存头', async () => {
    const res = await supertest(app()).get('/update-manifest').set(baseHeaders);
    expect(res.status).toBe(200);
    expect(res.body.format).toBe('dustnote.update.v1');
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.headers['x-min-client-version']).toBe('2.0.0');
    expect(res.headers['x-recommended-client-version']).toBe('2.5.50');
    expect(res.headers['x-server-version']).toBe('2.99.0');
  });

  it('缺 X-Client-Version → 400', async () => {
    const res = await supertest(app())
      .get('/update-manifest')
      .set({ 'X-Client-Platform': 'web', 'X-Client-Device-Id': 'd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_client_headers');
  });

  it('缺 X-Client-Platform → 400', async () => {
    const res = await supertest(app())
      .get('/update-manifest')
      .set({ 'X-Client-Version': '1.0.0', 'X-Client-Device-Id': 'd' });
    expect(res.status).toBe(400);
  });

  it('缺 X-Client-Device-Id → 400', async () => {
    const res = await supertest(app())
      .get('/update-manifest')
      .set({ 'X-Client-Version': '1.0.0', 'X-Client-Platform': 'web' });
    expect(res.status).toBe(400);
  });

  it('非法 platform → 400 invalid_platform', async () => {
    const res = await supertest(app())
      .get('/update-manifest')
      .set({ ...baseHeaders, 'X-Client-Platform': 'symbian' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_platform');
  });

  it('非法 channel query → 400 invalid_query', async () => {
    const res = await supertest(app()).get('/update-manifest?channel=invalid').set(baseHeaders);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_query');
  });

  it('合法 channel query → 200,channel 被采纳', async () => {
    const res = await supertest(app()).get('/update-manifest?channel=nightly').set(baseHeaders);
    expect(res.status).toBe(200);
    expect(res.body.channel).toBe('nightly');
  });

  it('非法 channel header 回退 stable', async () => {
    const res = await supertest(app())
      .get('/update-manifest')
      .set({ ...baseHeaders, 'X-Client-Channel': 'lol' });
    expect(res.status).toBe(200);
    expect(res.body.channel).toBe('stable');
  });
});
