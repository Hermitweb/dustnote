/**
 * 小程序 2FA/TOTP 客户端 API
 *
 * 统一走 getApi()（ApiClient 自动带上 baseUrl / token / taroFetch 适配），
 * 不再手工拼 Taro.request —— 旧实现引用了 store 上不存在的 api/getApiBase 字段。
 */

import { getApi } from '../state/auth';

export interface TotpSetupResult {
  secret: string;
  uri: string;
}

export async function setup2fa(): Promise<TotpSetupResult> {
  return getApi().request<TotpSetupResult>('POST', '/auth/2fa/setup');
}

export async function enable2fa(code: string): Promise<{ ok: boolean; enabled: boolean }> {
  return getApi().request<{ ok: boolean; enabled: boolean }>('POST', '/auth/2fa/enable', { code });
}

export async function disable2fa(code: string): Promise<{ ok: boolean; enabled: boolean }> {
  return getApi().request<{ ok: boolean; enabled: boolean }>('POST', '/auth/2fa/disable', { code });
}

export async function get2faStatus(): Promise<{ enabled: boolean }> {
  return getApi().request<{ enabled: boolean }>('GET', '/auth/2fa/status');
}
