/**
 * 移动端 2FA/TOTP 客户端 API
 */

import { api } from '../api';

export interface TotpSetupResult {
  secret: string;
  uri: string;
}

export async function setup2fa(): Promise<TotpSetupResult> {
  return api.post<TotpSetupResult>('/auth/2fa/setup');
}

export async function enable2fa(code: string): Promise<{ ok: boolean; enabled: boolean }> {
  return api.post('/auth/2fa/enable', { code });
}

export async function disable2fa(code: string): Promise<{ ok: boolean; enabled: boolean }> {
  return api.post('/auth/2fa/disable', { code });
}

export async function get2faStatus(): Promise<{ enabled: boolean }> {
  return api.get('/auth/2fa/status');
}
