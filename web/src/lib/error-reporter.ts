/**
 * Web/桌面端自动错误上报（P0-4 采集扩端，2026-09-25）
 *
 * 与 mobile/src/lib/diagnostics.ts 同一契约：错误摘要排队 → 批量 POST
 * /api/v1/diagnostics/reports（匿名可达，服务端截断/URL 剥离/30 天修剪）。
 * 接收端永远是用户自己的服务器。与两个"近亲"的分工：
 * - lib/diagnostics.ts：本地环形日志器（用户主动导出，从不自动外发）
 * - lib/sentry.ts：第三方崩溃平台（仅当配置了 VITE_SENTRY_DSN 才活）
 * 本模块填的是自托管用户（通常没有 Sentry DSN）"错误自动回到作者手里"的空档。
 * 桌面端复用 web 构建，自动覆盖。
 *
 * 隐私：只发 message（截 600）+ 堆栈（截 4000）+ 平台/版本；
 * URL 剥离；绝不含笔记内容/密钥；localStorage 开关键与 mobile 语义一致
 * （dustnote_diag_disabled === '1' 即完全禁用并清队列）。
 */
import { getDeviceId } from './device';
import { isTauri } from './platform';

const QUEUE_KEY = 'dustno…s_v1';
const DISABLED_KEY = 'dustnote_diag_disabled';
const MAX_QUEUE = 50;
const BATCH = 20;

type DiagKind = 'error' | 'rejection' | 'network';

interface DiagEvent {
  kind: DiagKind;
  message: string;
  stack?: string;
  at: string;
}

const clientPlatform = (): 'web' | 'desktop' => (isTauri() ? 'desktop' : 'web');

function sanitize(text: string, max: number): string {
  return text.replace(/https?:\/\/\S+/g, '[url]').slice(0, max);
}

function isDisabled(): boolean {
  try {
    return localStorage.getItem(DISABLED_KEY) === '1';
  } catch {
    return false;
  }
}

/** 设置页读取开关（默认开） */
export function getDiagnosticsEnabled(): boolean {
  return !isDisabled();
}

/** 设置页切换；关闭立即清空积压队列 */
export function setDiagnosticsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(DISABLED_KEY, enabled ? '0' : '1');
    if (!enabled) localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* 隐私模式下静默 */
  }
}

function loadQueue(): DiagEvent[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DiagEvent[]) : [];
  } catch {
    return [];
  }
}

export function enqueueDiagEvent(kind: DiagKind, message: string, stack?: string): void {
  if (isDisabled()) return;
  try {
    const norm = sanitize(message || '(empty)', 600);
    const queue = loadQueue();
    const idx = queue.findIndex((e) => e.kind === kind && e.message === norm);
    if (idx >= 0) queue.splice(idx, 1);
    const ev: DiagEvent = { kind, message: norm, at: new Date().toISOString() };
    // exactOptionalPropertyTypes：无 stack 时不得写 stack: undefined
    if (stack) ev.stack = sanitize(stack, 4000);
    queue.push(ev);
    while (queue.length > MAX_QUEUE) queue.shift();
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* 上报通道自身永不成为错误源 */
  }
}

let flushing = false;

/** 回传一批（≤20）。匿名直连 fetch——不走 authFetch，避免与 401 刷新互相触发。 */
export async function flushErrorReports(): Promise<void> {
  if (flushing || isDisabled()) return;
  const queue = loadQueue();
  if (queue.length === 0) return;
  flushing = true;
  try {
    const batch = queue.slice(-BATCH);
    const platform = clientPlatform();
    const res = await fetch('/api/v1/diagnostics/reports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Version': __APP_VERSION__,
        'X-Client-Platform': platform,
        'X-Client-Channel': 'stable',
        'X-Client-Device-Id': getDeviceId(),
      },
      body: JSON.stringify({
        events: batch.map((e) => ({
          kind: e.kind,
          message: e.message,
          stack: e.stack,
          platform,
          clientVersion: __APP_VERSION__,
        })),
      }),
    });
    if (res.ok) {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(0, -batch.length)));
    }
  } catch {
    /* 离线保留队列 */
  } finally {
    flushing = false;
  }
}

/**
 * 安装全局采集（main.tsx 顶层调用一次）+ 启动/回前台补投。
 * 与 Sentry 监听并存互不影响（各自独立 addEventListener）。
 */
export function installErrorReporter(): void {
  window.addEventListener('error', (e) => {
    enqueueDiagEvent('error', e.message ?? 'unknown error', e.error?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    enqueueDiagEvent(
      'rejection',
      r instanceof Error ? r.message : String(r),
      r instanceof Error ? r.stack : undefined
    );
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushErrorReports();
  });
  window.setTimeout(() => void flushErrorReports(), 3000);
}
