/**
 * 2FA/TOTP 客户端 API
 *
 * 管理 TOTP 两步验证的设置、启用、禁用和状态查询。
 */

import { api } from './store-helpers';

export interface TotpSetupResult {
  secret: string;
  uri: string;
}

export interface TotpStatus {
  enabled: boolean;
}

/**
 * 生成 TOTP 密钥和 QR 码 URI（需要已登录）
 */
export async function setup2fa(): Promise<TotpSetupResult> {
  return api().post<TotpSetupResult>('/auth/2fa/setup');
}

/**
 * 验证 TOTP 码并启用 2FA
 */
export async function enable2fa(code: string): Promise<{ ok: boolean; enabled: boolean }> {
  return api().post('/auth/2fa/enable', { code });
}

/**
 * 验证 TOTP 码后禁用 2FA
 */
export async function disable2fa(code: string): Promise<{ ok: boolean; enabled: boolean }> {
  return api().post('/auth/2fa/disable', { code });
}

/**
 * 查询 2FA 状态
 */
export async function get2faStatus(): Promise<TotpStatus> {
  return api().get<TotpStatus>('/auth/2fa/status');
}
