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

/** 网络层错误（fetch 失败 / 客户端超时 abort）的归桶 key（各端词典需提供） */
export const ERROR_NETWORK_KEY = 'errors.server_unreachable';

// 各运行时网络层错误的原始英文文案（小写后全匹配）。这些 message 若原样透传，
// 用户会在中文界面看到「signal is aborted without reason」之类的技术黑话
//（真机审计 2026-09-24：弱网解锁失败弹 AbortError 英文原文）。
const NETWORK_RAW_MESSAGES: ReadonlySet<string> = new Set([
  'network request failed', // React Native / Android fetch
  'failed to fetch', // Chrome / Edge / Safari web fetch
  'networkerror when attempting to fetch resource.', // Firefox
  'signal is aborted without reason', // AbortController 超时（RN Hermes）
  'this operation was aborted', // DOMException AbortError（web 变体）
  'aborted', // node-fetch 时代旧文案
]);

/**
 * 是否为「客户端网络层」错误：无服务端错误码，且形态来自 fetch/abort/小程序
 * request:fail。自有超时（AbortController）按 name 识别。
 */
export function isClientNetworkError(err: unknown): boolean {
  const e = err as { name?: unknown; message?: unknown } | null | undefined;
  if (e?.name === 'AbortError') return true;
  const raw = extractMessage(err).toLowerCase();
  if (!raw) return false;
  // 微信小程序：errMsg 形如 request:fail timeout / request:fail 等
  if (raw.startsWith('request:fail')) return true;
  return NETWORK_RAW_MESSAGES.has(raw);
}

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
 * 策略（两条都重要）：
 *
 * 1. **只对带服务端错误码的异常做桶映射**。无码异常可能是本地抛出的、且文案
 *    已经过 t() 翻译（如 `new Error(t('shares.error_not_json'))`）——若一并
 *    替换成桶文案，反而把已本地化的具体文案降级成泛化文案。
 *    客户端自有文案应在其抛出点翻译，不该走这里。
 *
 * 2. 服务端 message 只有中文，中文界面下它比桶文案**更具体**
 *    （如「文件夹名称过长」），所以：
 *    - 中文界面 → 原样用服务端文案
 *    - 非中文界面 → 用桶文案（否则英文界面里蹦中文）
 *
 * 无码且无文案时用 `errors.generic` 兜底；`defaultValue` 只在**该兜底键也缺失**
 * 时生效，作为词典漏配时的最后防线。
 *
 * @param translate 各端注入的取词函数（通常是 i18next 的 t）
 */
export function errorReason(
  err: unknown,
  uiLang: string | null | undefined,
  translate: (key: string, options?: { defaultValue?: string }) => string
): string {
  const raw = extractMessage(err);
  const code = apiErrorCode(err);
  if (!code) {
    // 网络层错误（超时 abort / fetch 失败）没有服务端码，raw 是英文技术原文，
    // 原样展示等于把 "signal is aborted without reason" 抛给用户——归入
    // server_unreachable 桶（raw 文案在中文界面反而丢信息，不进 defaultValue）。
    if (isClientNetworkError(err)) return translate(ERROR_NETWORK_KEY);
    return raw || translate(ERROR_GENERIC_KEY);
  }

  const key = errorI18nKey(code) ?? ERROR_GENERIC_KEY;
  const isChineseUi = typeof uiLang === 'string' && uiLang.toLowerCase().startsWith('zh');
  if (isChineseUi) return raw || translate(key);
  return translate(key, raw ? { defaultValue: raw } : undefined);
}
