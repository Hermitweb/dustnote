/**
 * 错误码 → i18n key 映射单测（技术债清理）
 *
 * 价值：客户端不再依赖服务端中文文案（硬匹配会在改文案时静默失效）。
 * 这里锁定已知码的归桶结果与未知码的回退语义。
 */
import { describe, it, expect } from 'vitest';
import { ERROR_BUCKETS, apiErrorCode, errorI18nKey } from '../src/error-codes.js';

describe('errorI18nKey', () => {
  it('maps auth / session codes to their buckets', () => {
    expect(errorI18nKey('unauthorized')).toBe(ERROR_BUCKETS.auth);
    expect(errorI18nKey('invalid_credentials')).toBe(ERROR_BUCKETS.credentials);
    expect(errorI18nKey('totp_required')).toBe(ERROR_BUCKETS.totp);
    expect(errorI18nKey('invalid_totp')).toBe(ERROR_BUCKETS.totp);
    // 会话终态（被吊销/无 RT）走「会话已过期」文案
    expect(errorI18nKey('device_revoked')).toBe(ERROR_BUCKETS.sessionExpired);
    expect(errorI18nKey('invalid_refresh_token')).toBe(ERROR_BUCKETS.sessionExpired);
  });

  it('maps rate limiting and conflicts', () => {
    expect(errorI18nKey('too_many_writes')).toBe(ERROR_BUCKETS.rateLimited);
    expect(errorI18nKey('account_locked')).toBe(ERROR_BUCKETS.locked);
    expect(errorI18nKey('version_mismatch')).toBe(ERROR_BUCKETS.conflict);
    expect(errorI18nKey('id_conflict')).toBe(ERROR_BUCKETS.conflict);
  });

  it('maps not-found and server failures', () => {
    expect(errorI18nKey('not_found')).toBe(ERROR_BUCKETS.notFound);
    expect(errorI18nKey('note_not_found')).toBe(ERROR_BUCKETS.notFound);
    expect(errorI18nKey('internal_error')).toBe(ERROR_BUCKETS.server);
  });

  it('returns null for unknown / empty codes (caller falls back to server message)', () => {
    expect(errorI18nKey('some_new_code_added_later')).toBeNull();
    expect(errorI18nKey(null)).toBeNull();
    expect(errorI18nKey(undefined)).toBeNull();
    expect(errorI18nKey('')).toBeNull();
  });

  it('every mapped bucket has a distinct i18n key (no accidental aliasing)', () => {
    const keys = Object.values(ERROR_BUCKETS);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.startsWith('errors.'))).toBe(true);
  });
});

describe('apiErrorCode', () => {
  it('extracts the code from an ApiException-shaped error', () => {
    expect(apiErrorCode({ err: { code: 'totp_required', status: 401, message: 'x' } })).toBe(
      'totp_required'
    );
  });

  it('returns null for non-API errors (network TypeError, plain Error, nullish)', () => {
    expect(apiErrorCode(new TypeError('Failed to fetch'))).toBeNull();
    expect(apiErrorCode(new Error('boom'))).toBeNull();
    expect(apiErrorCode(null)).toBeNull();
    expect(apiErrorCode({ err: { code: 42 } })).toBeNull();
  });
});
