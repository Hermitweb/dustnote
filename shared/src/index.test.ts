/**
 * shared/index.ts barrel 冒烟测试 —— 验证 public API 从入口可见
 */
import { describe, it, expect } from 'vitest';
import {
  // 编码
  encodeUtf8,
  decodeUtf8,
  toBase64,
  fromBase64,
  toBase64Url,
  fromBase64Url,
  // 加密
  randomBytes,
  encrypt,
  decrypt,
  encryptString,
  decryptString,
  noteAad,
  generateRecoveryCode,
  isValidRecoveryCode,
  normalizeRecoveryCode,
  constantTimeEqual,
  zeroize,
  isCiphertext,
  // KDF
  KDF_PARAMS,
  KDF_PARAMS_MOBILE,
  KEK_INFO,
  AUTH_INFO,
  KDF_VERSION,
  deriveKey,
  deriveSecrets,
  hkdf,
  // wrapKey/unwrapKey
  wrapKey,
  unwrapKey,
  generateMasterKey,
  // 工具
  isPrivateAddress,
  MOTION,
  MOTION_CSS_VARS,
  PRESET_TEMPLATES,
  PRESET_TEMPLATE_IDS,
  formatNoteStamp,
  formatDateTimeStamp,
} from './index.js';

describe('shared barrel (index.ts) 公共 API 契约', () => {
  it('所有 public 函数 / 常量 / 类都从 barrel 正确暴露', () => {
    // 函数
    expect(typeof encodeUtf8).toBe('function');
    expect(typeof decodeUtf8).toBe('function');
    expect(typeof toBase64).toBe('function');
    expect(typeof fromBase64).toBe('function');
    expect(typeof toBase64Url).toBe('function');
    expect(typeof fromBase64Url).toBe('function');
    expect(typeof randomBytes).toBe('function');
    expect(typeof encrypt).toBe('function');
    expect(typeof decrypt).toBe('function');
    expect(typeof encryptString).toBe('function');
    expect(typeof decryptString).toBe('function');
    expect(typeof noteAad).toBe('function');
    expect(typeof generateRecoveryCode).toBe('function');
    expect(typeof isValidRecoveryCode).toBe('function');
    expect(typeof normalizeRecoveryCode).toBe('function');
    expect(typeof constantTimeEqual).toBe('function');
    expect(typeof zeroize).toBe('function');
    expect(typeof isCiphertext).toBe('function');
    expect(typeof deriveKey).toBe('function');
    expect(typeof deriveSecrets).toBe('function');
    expect(typeof hkdf).toBe('function');
    expect(typeof wrapKey).toBe('function');
    expect(typeof unwrapKey).toBe('function');
    expect(typeof generateMasterKey).toBe('function');
    expect(typeof isPrivateAddress).toBe('function');
    expect(typeof formatNoteStamp).toBe('function');
    expect(typeof formatDateTimeStamp).toBe('function');

    // 常量
    expect(typeof KDF_PARAMS).toBe('object');
    expect(typeof KDF_PARAMS_MOBILE).toBe('object');
    expect(typeof KEK_INFO).toBe('string');
    expect(typeof AUTH_INFO).toBe('string');
    expect(typeof KDF_VERSION).toBe('number');
    expect(typeof MOTION).toBe('object');
    expect(typeof MOTION_CSS_VARS).toBe('object');
    expect(Array.isArray(PRESET_TEMPLATES)).toBe(true);
    expect(Array.isArray(PRESET_TEMPLATE_IDS)).toBe(true);
  });

  it('运行时端到端：encode → 加密 → 解密 → decode（核心循环）', async () => {
    const key = randomBytes(32);
    const plain = 'barrel 入口可用性测试';
    const ct = await encryptString(key, plain);
    const out = await decryptString(key, ct);
    expect(out).toBe(plain);
  });
});
