/**
 * web/src/lib/webauthn-client.ts 单测 —— Passkey 注册/认证流程
 *
 * @simplewebauthn/browser 三个 API 全部 mock；api() 也 mock。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { startRegistration, startAuthentication, browserSupportsWebAuthn } = vi.hoisted(() => ({
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
}));

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock('./store-helpers', () => ({
  api: () => api,
}));

import { registerPasskey, authenticateWithPasskey } from './webauthn-client.js';

describe('webauthn-client', () => {
  beforeEach(() => {
    startRegistration.mockReset();
    startAuthentication.mockReset();
    api.get.mockReset();
    api.post.mockReset();
  });

  describe('registerPasskey', () => {
    it('完整三步：GET options → startRegistration → POST verify', async () => {
      api.get.mockResolvedValueOnce({
        challenge: 'ch1',
        rp: { name: 'r' },
        user: { id: 'u', name: 'n' },
      });
      startRegistration.mockResolvedValueOnce({
        id: 'att1',
        rawId: 'r1',
        response: {},
        type: 'public-key',
      });
      api.post.mockResolvedValueOnce({ verified: true, deviceId: 'dev-1' });

      const out = await registerPasskey();
      expect(out).toEqual({ verified: true, deviceId: 'dev-1' });
      expect(api.get).toHaveBeenCalledWith('/auth/webauthn/register/options');
      expect(startRegistration).toHaveBeenCalledWith({
        optionsJSON: expect.objectContaining({ challenge: 'ch1' }),
      });
      expect(api.post).toHaveBeenCalledWith('/auth/webauthn/register/verify', {
        response: expect.objectContaining({ id: 'att1' }),
      });
    });

    it('startRegistration 抛错 → 透传', async () => {
      api.get.mockResolvedValueOnce({ challenge: 'ch' });
      startRegistration.mockRejectedValueOnce(new Error('user cancel'));
      await expect(registerPasskey()).rejects.toThrow(/user cancel/);
    });
  });

  describe('authenticateWithPasskey', () => {
    it('完整三步：GET options → startAuthentication → POST verify → 含 accessToken', async () => {
      api.get.mockResolvedValueOnce({ challenge: 'ch2', allowCredentials: [] });
      startAuthentication.mockResolvedValueOnce({
        id: 'as1',
        rawId: 'r2',
        response: {},
        type: 'public-key',
      });
      api.post.mockResolvedValueOnce({ verified: true, accessToken: 'tok', userId: 'u-1' });

      const out = await authenticateWithPasskey();
      expect(out).toEqual({ verified: true, accessToken: 'tok', userId: 'u-1' });
      expect(api.get).toHaveBeenCalledWith('/auth/webauthn/authenticate/options');
      expect(startAuthentication).toHaveBeenCalledWith({
        optionsJSON: expect.objectContaining({ challenge: 'ch2' }),
      });
      expect(api.post).toHaveBeenCalledWith('/auth/webauthn/authenticate/verify', {
        response: expect.objectContaining({ id: 'as1' }),
      });
    });
  });
});
