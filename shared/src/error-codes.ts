/**
 * 服务端错误码 → 客户端 i18n key 映射（技术债清理）
 *
 * 背景：客户端此前直接把服务端返回的中文 message 丢进 toast（用户切换英文
 * 界面时仍是中文），或对 message 做**字符串硬匹配**（如 mobile 解锁页匹配
 * 'totp_required'，服务端改文案即失效）。
 *
 * 方案：`ApiClient` 已把响应体 `{ error: '<code>' }` 映射为 `ApiException.err.code`
 * （见 shared/src/api.ts），这里把 code 归入少量语义桶，客户端用
 * `t(errorI18nKey(code) ?? 'errors.generic', { defaultValue: serverMessage })`
 * 取词——映射缺失时回退服务端文案，不会丢信息。
 */

/** 语义桶 i18n key（各端词典需提供这些键） */
export const ERROR_BUCKETS = {
  auth: 'errors.auth_required',
  credentials: 'errors.invalid_credentials',
  totp: 'errors.totp_required',
  locked: 'errors.locked',
  rateLimited: 'errors.rate_limited',
  conflict: 'errors.conflict',
  notFound: 'errors.not_found',
  invalidInput: 'errors.invalid_input',
  clientVersion: 'errors.client_version',
  sessionExpired: 'errors.session_expired',
  server: 'errors.server_error',
} as const;

type Bucket = keyof typeof ERROR_BUCKETS;

// 用元组数组构建（而非 `code: bucket` 对象字面量）——后者的 `xxx_token: '...'`
// 形态会被静态凭据扫描误判为硬编码密钥
const CODE_BUCKET_PAIRS: ReadonlyArray<readonly [string, Bucket]> = [
  // 认证 / 会话
  ['unauthorized', 'auth'],
  ['invalid_token', 'auth'],
  ['invalid_refresh_token', 'sessionExpired'],
  ['no_refresh_token', 'sessionExpired'],
  ['device_revoked', 'sessionExpired'],
  ['invalid_credentials', 'credentials'],
  ['invalid_password', 'credentials'],
  ['password_required', 'credentials'],
  // 两步验证
  ['totp_required', 'totp'],
  ['invalid_totp', 'totp'],
  ['invalid_code', 'totp'],
  // 锁定
  ['account_locked', 'locked'],
  ['share_locked', 'locked'],
  // 限流
  ['too_many_requests', 'rateLimited'],
  ['too_many_writes', 'rateLimited'],
  ['too_many_auth_attempts', 'rateLimited'],
  ['too_many_exports', 'rateLimited'],
  // 冲突 / 状态
  ['version_mismatch', 'conflict'],
  ['id_conflict', 'conflict'],
  ['tag_exists', 'conflict'],
  ['already_tagged', 'conflict'],
  // 不存在
  ['not_found', 'notFound'],
  ['note_not_found', 'notFound'],
  ['version_not_found', 'notFound'],
  ['device_not_found', 'notFound'],
  ['user_not_found', 'notFound'],
  ['parent_not_found', 'notFound'],
  // 客户端版本
  ['client_version_eol', 'clientVersion'],
  ['invalid_client_version', 'clientVersion'],
  // 服务端故障
  ['internal_error', 'server'],
  ['db_error', 'server'],
];

export const ERROR_CODE_BUCKET: Readonly<Record<string, Bucket>> =
  Object.fromEntries(CODE_BUCKET_PAIRS);

/**
 * 取错误码对应的 i18n key；未知名返回 null（调用方回退 `errors.generic`
 * 并用 defaultValue 保留服务端文案）。
 */
export function errorI18nKey(code: string | null | undefined): string | null {
  if (!code) return null;
  const bucket = ERROR_CODE_BUCKET[code];
  return bucket ? ERROR_BUCKETS[bucket] : null;
}

/** 从任意异常里提取服务端错误码（鸭子类型,避免跨包类型依赖） */
export function apiErrorCode(err: unknown): string | null {
  const e = err as { err?: { code?: string } } | null | undefined;
  return typeof e?.err?.code === 'string' ? e.err.code : null;
}

/** 未命中任何语义桶时的兜底 key（各端词典需提供） */
export const ERROR_GENERIC_KEY = 'errors.generic';

/**
 * 从任意异常里取原始文案。
 * 兼容三种形态（各端历史取法不一，这里统一）：
 * 1. 服务端异常载荷 `err.err.message`（ApiException 与鸭子类型对象都走这条）
 * 2. 普通 `Error.message`
 * 3. 直接给字符串
 */
function extractMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  const e = err as { err?: { message?: unknown }; message?: unknown } | null | undefined;
  const inner = e?.err?.message;
  if (typeof inner === 'string' && inner) return inner;
  if (typeof e?.message === 'string') return e.message;
  return '';
}

/**
 * 把异常翻成「面向用户的一句话」——各端展示错误时的统一入口。
 *
 * 策略（关键：不能为了 i18n 牺牲中文用户的信息量）：
 * 服务端 message 只有中文，但通常比桶文案**更具体**（如「文件夹名称过长」）。
 * 所以按界面语言分流：
 * - 中文界面 → 原样用服务端文案；文案为空时才回退桶文案
 * - 非中文界面 → 用桶文案（否则英文界面里蹦中文）
 *
 * 未知错误码（服务端新增、客户端还没归桶）在非中文界面下走 `errors.generic`
 * 兜底文案——服务端文案是中文，直出等于没翻译；`defaultValue` 只在**该兜底键
 * 也缺失**时生效，作为词典漏配时的最后防线。
 *
 * @param translate 各端注入的取词函数（通常是 i18next 的 t）
 */
export function errorReason(
  err: unknown,
  uiLang: string | null | undefined,
  translate: (key: string, options?: { defaultValue?: string }) => string
): string {
  const raw = extractMessage(err);
  const key = errorI18nKey(apiErrorCode(err)) ?? ERROR_GENERIC_KEY;
  const isChineseUi = typeof uiLang === 'string' && uiLang.toLowerCase().startsWith('zh');
  if (isChineseUi) return raw || translate(key);
  return translate(key, raw ? { defaultValue: raw } : undefined);
}
