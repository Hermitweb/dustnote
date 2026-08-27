/**
 * WebAuthn/Passkey 客户端 API
 *
 * 使用 @simplewebauthn/browser 实现浏览器端 WebAuthn。
 */

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser';
import { api } from './store-helpers';

export { browserSupportsWebAuthn };

/**
 * 注册 Passkey
 *
 * 流程：服务端生成 challenge → 浏览器调用 WebAuthn API → 服务端验证并存储
 */
export async function registerPasskey(): Promise<{ verified: boolean; deviceId?: string }> {
  // 1. 从服务端获取注册选项
  const options = await api().get('/auth/webauthn/register/options') as Record<string, unknown>;

  // 2. 调用浏览器 WebAuthn API
  const attestationResponse = await startRegistration({ optionsJSON: options as any });

  // 3. 发送到服务端验证
  const result = await api().post<{ verified: boolean; deviceId?: string }>(
    '/auth/webauthn/register/verify',
    { response: attestationResponse }
  );

  return result;
}

/**
 * 用 Passkey 认证（登录/解锁）
 *
 * 流程：服务端生成 challenge → 浏览器调用 WebAuthn API → 服务端验证
 */
export async function authenticateWithPasskey(): Promise<{
  verified: boolean;
  accessToken?: string;
  userId?: string;
}> {
  // 1. 从服务端获取认证选项
  const options = await api().get('/auth/webauthn/authenticate/options') as Record<string, unknown>;

  // 2. 调用浏览器 WebAuthn API
  const assertionResponse = await startAuthentication({ optionsJSON: options as any });

  // 3. 发送到服务端验证
  const result = await api().post<{
    verified: boolean;
    accessToken?: string;
    userId?: string;
  }>('/auth/webauthn/authenticate/verify', { response: assertionResponse });

  return result;
}
