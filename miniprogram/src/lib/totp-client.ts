/**
 * 小程序 2FA/TOTP 客户端 API
 */

import { useAuthStore } from '../state/auth';

async function apiRequest(method: string, path: string, body?: unknown) {
  const { api } = useAuthStore.getState();
  // 小程序 api 对象需要通过 store 获取
  const baseUrl = useAuthStore.getState().getApiBase?.() ?? '';
  const token = useAuthStore.getState().accessToken;
  const res = await new Promise<any>((resolve, reject) => {
    const Taro = require('@tarojs/taro');
    Taro.request({
      url: `${baseUrl}${path}`,
      method: method as any,
      data: body,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success: (r: any) => resolve(r.data),
      fail: reject,
    });
  });
  return res;
}

export interface TotpSetupResult {
  secret: string;
  uri: string;
}

export async function setup2fa(): Promise<TotpSetupResult> {
  return apiRequest('POST', '/auth/2fa/setup');
}

export async function enable2fa(code: string): Promise<{ ok: boolean; enabled: boolean }> {
  return apiRequest('POST', '/auth/2fa/enable', { code });
}

export async function disable2fa(code: string): Promise<{ ok: boolean; enabled: boolean }> {
  return apiRequest('POST', '/auth/2fa/disable', { code });
}

export async function get2faStatus(): Promise<{ enabled: boolean }> {
  return apiRequest('GET', '/auth/2fa/status');
}
