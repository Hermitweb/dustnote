/**
 * web/src/lib/totp-client.ts 单测 —— TOTP API 客户端薄封装
 *
 * 四个函数全部是 api().get/post 的薄包装：mock api，断言调用了正确端点。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setup2fa, enable2fa, disable2fa, get2faStatus } from './totp-client.js';

const api = {
  get: vi.fn(),
  post: vi.fn(),
};
vi.mock('./store-helpers', () => ({
  api: () => api,
}));

describe('totp-client', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
  });

  it('setup2fa → POST /auth/2fa/setup', async () => {
    api.post.mockResolvedValueOnce({ secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://...' });
    const out = await setup2fa();
    expect(out).toEqual({ secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://...' });
    expect(api.post).toHaveBeenCalledWith('/auth/2fa/setup');
  });

  it('enable2fa → POST /auth/2fa/enable 带 code', async () => {
    api.post.mockResolvedValueOnce({ ok: true, enabled: true });
    const out = await enable2fa('123456');
    expect(out).toEqual({ ok: true, enabled: true });
    expect(api.post).toHaveBeenCalledWith('/auth/2fa/enable', { code: '123456' });
  });

  it('disable2fa → POST /auth/2fa/disable 带 code', async () => {
    api.post.mockResolvedValueOnce({ ok: true, enabled: false });
    const out = await disable2fa('654321');
    expect(out).toEqual({ ok: true, enabled: false });
    expect(api.post).toHaveBeenCalledWith('/auth/2fa/disable', { code: '654321' });
  });

  it('get2faStatus → GET /auth/2fa/status', async () => {
    api.get.mockResolvedValueOnce({ enabled: true });
    const out = await get2faStatus();
    expect(out).toEqual({ enabled: true });
    expect(api.get).toHaveBeenCalledWith('/auth/2fa/status');
  });
});
