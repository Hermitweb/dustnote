/**
 * 客户端诊断日志系统
 *
 * 设计：
 * - 环形缓冲区，最近 1000 条日志，存 IndexedDB
 * - 三级日志：info / warn / error
 * - 支持"导出诊断日志"按钮，脱敏后导出 JSON
 * - 用于用户报告 bug 时提供运行时证据
 *
 * 防坑：个人项目最大的维护成本是"用户说出错了你却拿不到证据"。
 * 此模块是底线，所有 catch 块都应调用 logger.error()。
 */

import { get, set } from 'idb-keyval';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  /** ISO 时间戳 */
  ts: string;
  level: LogLevel;
  /** 模块名（如 'crypto' / 'sync-ws' / 'editor'） */
  module: string;
  msg: string;
  /** 结构化上下文（脱敏后存储） */
  ctx: Record<string, unknown> | undefined;
}

const DIAG_KEY = 'dustnote:diagnostics';
const MAX_ENTRIES = 1000;

let buffer: LogEntry[] | null = null;

async function ensureLoaded(): Promise<LogEntry[]> {
  if (buffer) return buffer;
  const persisted = (await get<LogEntry[]>(DIAG_KEY)) ?? [];
  buffer = persisted;
  return buffer;
}

async function persist(): Promise<void> {
  if (buffer) await set(DIAG_KEY, buffer);
}

/** 敏感字段名（包含匹配，覆盖 accessToken/masterKey/authKey/wrappedMasterKey 等组合名） */
const SENSITIVE_KEY_PATTERN =
  /token|secret|password|master|auth|pwd|pass|cookie|key|salt|hash|recovery/i;

/** 递归脱敏：对象含敏感字段 → [REDACTED]；超长字符串截断 */
function sanitizeValue(key: string, value: unknown, depth = 0): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[REDACTED]';
  if (depth > 5) return '[deep]';
  if (typeof value === 'string') {
    return value.length > 200 ? value.slice(0, 200) + '...[truncated]' : value;
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => sanitizeValue(String(i), v, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeValue(k, v, depth + 1);
    }
    return out;
  }
  return value;
}

/** 脱敏：移除密钥、token、密码等敏感字段（含嵌套对象与组合键名） */
function sanitize(ctx: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!ctx) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    out[k] = sanitizeValue(k, v);
  }
  return out;
}

/** 写入一条日志 */
export async function log(
  level: LogLevel,
  module: string,
  msg: string,
  ctx?: Record<string, unknown>
): Promise<void> {
  const buf = await ensureLoaded();
  // 先脱敏再存储：日志文件与导出内容不落任何敏感字段
  const safeCtx = sanitize(ctx);
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    module,
    msg,
    ctx: safeCtx,
  };
  buf.push(entry);
  // 环形缓冲：超过上限丢弃最旧的
  if (buf.length > MAX_ENTRIES) {
    buf.splice(0, buf.length - MAX_ENTRIES);
  }
  await persist();
  // 同步输出到 console（开发时可见）：用脱敏后的 safeCtx，而非原始 ctx
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[${module}] ${msg}`, safeCtx ?? '');
}

/** 便捷方法 */
export const logger = {
  info: (module: string, msg: string, ctx?: Record<string, unknown>) =>
    log('info', module, msg, ctx),
  warn: (module: string, msg: string, ctx?: Record<string, unknown>) =>
    log('warn', module, msg, ctx),
  error: (module: string, msg: string, ctx?: Record<string, unknown>) =>
    log('error', module, msg, ctx),
};

/** 读取全部日志（用于导出） */
export async function getAllLogs(): Promise<LogEntry[]> {
  return [...(await ensureLoaded())];
}

/** 清空日志 */
export async function clearLogs(): Promise<void> {
  buffer = [];
  await set(DIAG_KEY, []);
}

/**
 * 导出诊断日志为 JSON 文件
 * 包含：日志 + 浏览器/应用环境信息（脱敏）
 */
export async function exportDiagnostics(): Promise<void> {
  const logs = await getAllLogs();
  const report = {
    exportedAt: new Date().toISOString(),
    appVersion: __APP_VERSION__,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    online: navigator.onLine,
    storage: await getStorageEstimate(),
    url: location.origin,
    logs,
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dustnote-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 获取存储配额估算（IndexedDB 用量监控） */
export async function getStorageEstimate(): Promise<{
  usage: number;
  quota: number;
  usagePercent: number;
}> {
  if (!navigator.storage?.estimate) {
    return { usage: 0, quota: 0, usagePercent: 0 };
  }
  const est = await navigator.storage.estimate();
  const usage = est.usage ?? 0;
  const quota = est.quota ?? 0;
  return {
    usage,
    quota,
    usagePercent: quota > 0 ? Math.round((usage / quota) * 100) : 0,
  };
}
