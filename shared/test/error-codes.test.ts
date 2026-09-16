/**
 * 错误码 → i18n key 映射单测（技术债清理）
 *
 * 价值：客户端不再依赖服务端中文文案（硬匹配会在改文案时静默失效）。
 * 这里锁定已知码的归桶结果与未知码的回退语义。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  ERROR_BUCKETS,
  ERROR_GENERIC_KEY,
  apiErrorCode,
  errorI18nKey,
  errorReason,
} from '../src/error-codes.js';

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

describe('errorReason', () => {
  /** 假词典：桶 key 一律返回英文占位，并按 i18next 语义处理 defaultValue */
  const dict: Record<string, string> = {
    [ERROR_BUCKETS.credentials]: 'Incorrect password',
    [ERROR_BUCKETS.sessionExpired]: 'Session expired',
    [ERROR_GENERIC_KEY]: 'Something went wrong',
  };
  const translate = vi.fn((key: string, options?: { defaultValue?: string }) => {
    return dict[key] ?? options?.defaultValue ?? key;
  });

  const apiErr = (code: string, message: string) => ({ err: { code, status: 400, message } });

  it('中文界面：原样用服务端文案（更具体，别被桶文案覆盖）', () => {
    expect(errorReason(apiErr('invalid_credentials', '密码错误'), 'zh-CN', translate)).toBe(
      '密码错误'
    );
    expect(errorReason(new Error('文件夹名称过长'), 'zh', translate)).toBe('文件夹名称过长');
  });

  it('非中文界面：用桶文案，避免英文界面里蹦中文', () => {
    expect(errorReason(apiErr('invalid_credentials', '密码错误'), 'en', translate)).toBe(
      'Incorrect password'
    );
  });

  it('非中文界面 + 未知码：走兜底文案（服务端文案是中文，直出等于没翻译）', () => {
    expect(errorReason(apiErr('some_new_code', '服务端限流'), 'en-US', translate)).toBe(
      'Something went wrong'
    );
  });

  it('非中文界面 + 兜底键也漏配：回退服务端文案（词典漏配时的最后防线）', () => {
    const bare = vi.fn((key: string, options?: { defaultValue?: string }) => {
      // 模拟词典里**没有** errors.generic：i18next 此时用 defaultValue 兜底
      const val = key === ERROR_GENERIC_KEY ? undefined : dict[key];
      return val ?? options?.defaultValue ?? key;
    });
    expect(errorReason(apiErr('some_new_code', '服务端限流'), 'en', bare)).toBe('服务端限流');
  });

  it('非中文界面 + 未知码 + 无文案：用兜底文案', () => {
    expect(errorReason(apiErr('some_new_code', ''), 'en', translate)).toBe('Something went wrong');
  });

  it('中文界面 + 无文案：用桶文案（不显示空字符串）', () => {
    expect(errorReason(apiErr('invalid_credentials', ''), 'zh-CN', translate)).toBe(
      'Incorrect password'
    );
  });

  it('接受字符串与陌生类型，不抛异常', () => {
    expect(errorReason('直接给的文案', 'zh-CN', translate)).toBe('直接给的文案');
    expect(errorReason(undefined, 'en', translate)).toBe('Something went wrong');
    expect(errorReason({ weird: true }, 'zh-CN', translate)).toBe('Something went wrong');
  });
});
