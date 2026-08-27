/**
 * WebAuthn/Passkey 服务端实现
 *
 * 使用 @simplewebauthn/server 实现 FIDO2 WebAuthn：
 * - 注册：生成 PublicKeyCredentialCreationOptions → 验证 attestation
 * - 认证：生成 PublicKeyCredentialRequestOptions → 验证 assertion
 *
 * Passkey 作为 2FA 的替代/补充，提供无密码或第二因素认证。
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { config } from '../env.js';

const RP_NAME = 'DustNote';
const RP_ID = new URL(config.webOrigin).hostname || 'localhost';
const ORIGIN = config.webOrigin;

/**
 * 生成注册选项（用户点「添加 Passkey」时调用）
 */
export function generatePasskeyRegistrationOptions(userId: string, userName: string) {
  const db = getDb();
  const existingDevices = db
    .prepare('SELECT credential_id, credential_public_key, counter FROM webauthn_devices WHERE user_id = ?')
    .all(userId) as { credential_id: string; credential_public_key: Buffer; counter: number }[];

  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new TextEncoder().encode(userId),
    userName,
    userDisplayName: userName,
    attestationType: 'none',
    excludeCredentials: existingDevices.map((d) => ({
      id: d.credential_id,
      type: 'public-key' as const,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform',
    },
  });
}

/**
 * 验证注册响应并存储设备
 */
export async function verifyPasskeyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  expectedChallenge: string
): Promise<{ verified: boolean; deviceId?: string }> {
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return { verified: false };
  }

  const { credential } = verification.registrationInfo;
  const db = getDb();

  const deviceId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO webauthn_devices (id, user_id, credential_id, credential_public_key, counter, transports)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    deviceId,
    userId,
    Buffer.from(credential.id).toString('base64url'),
    Buffer.from(credential.publicKey),
    credential.counter,
    JSON.stringify(credential.transports ?? [])
  );

  logger.info({ userId, deviceId }, 'WebAuthn 设备已注册');
  return { verified: true, deviceId };
}

/**
 * 生成认证选项（用户选择用 Passkey 登录时调用）
 */
export function generatePasskeyAuthenticationOptions(userId?: string) {
  const db = getDb();
  let devices: { credential_id: string }[] = [];

  if (userId) {
    devices = db
      .prepare('SELECT credential_id FROM webauthn_devices WHERE user_id = ?')
      .all(userId) as { credential_id: string }[];
  }

  return generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
    allowCredentials: devices.map((d) => ({
      id: d.credential_id,
      type: 'public-key' as const,
    })),
  });
}

/**
 * 验证认证响应
 */
export async function verifyPasskeyAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string
): Promise<{ verified: boolean; userId?: string }> {
  const db = getDb();
  const device = db
    .prepare('SELECT id, user_id, credential_id, credential_public_key, counter, transports FROM webauthn_devices WHERE credential_id = ?')
    .get(Buffer.from(response.id, 'base64url').toString('base64url')) as
    | { id: string; user_id: string; credential_id: string; credential_public_key: Buffer; counter: number; transports: string }
    | undefined;

  if (!device) {
    return { verified: false };
  }

  const credential = {
    id: device.credential_id,
    publicKey: new Uint8Array(device.credential_public_key),
    counter: device.counter,
    transports: JSON.parse(device.transports) as AuthenticatorTransportFuture[],
  };

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential,
  });

  if (!verification.verified) {
    return { verified: false };
  }

  // 更新 counter
  db.prepare('UPDATE webauthn_devices SET counter = ? WHERE id = ?').run(
    verification.authenticationInfo.newCounter,
    device.id
  );

  logger.info({ userId: device.user_id, deviceId: device.id }, 'WebAuthn 认证成功');
  return { verified: true, userId: device.user_id };
}
