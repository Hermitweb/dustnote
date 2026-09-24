/**
 * 移动端诊断采集与上报（OBS-R03，2026-09-25）
 *
 * 目标：让真机上的 JS 错误/未处理拒绝/关键网络失败**自动排队回传自建服务器**
 * （POST /api/v1/diagnostics/reports，匿名可达——崩溃多发生在鉴权链路），
 * 取代「插数据线 logcat 抓现场」的人肉排障。
 *
 * 隐私约束（与 docs/security-model.md 对齐）：
 * - 只回传用户自己的服务器，不接任何第三方崩溃平台；
 * - 采集面 = 错误 message（截 600）+ Hermes 堆栈帧（截 4000，只有函数名/行号）
 *   + 设备型号/系统版本/客户端版本；**绝不采集笔记内容、密钥、token**；
 * - message 兜底剥离 URL（防未来某处把带凭据的完整请求地址写进错误文案）；
 * - 本地队列 ≤50 条、同 message 去重计数；上传成功即清空，失败保留下次启动重试。
 *
 * 开关：AsyncStorage `dustnote_diag_disabled === '1'` 时完全禁用
 * （设置页开关 UI 为后续项，默认启用——接收端是用户本人的服务器）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { api } from '../api';
import { APP_VERSION } from './version';
import { useModeStore } from './mode-store';

const QUEUE_KEY = 'dustnote_diagno…s_v1';
const DISABLED_KEY = 'dustnote_diag_disabled';
const MAX_QUEUE = 50;

export type DiagKind = 'error' | 'rejection' | 'network';

interface DiagEvent {
  kind: DiagKind;
  message: string;
  stack?: string;
  at: string;
}

let installed = false;

/**
 * 队列以 AsyncStorage 为唯一事实源（读-改-写）。
 * 此前维护了一份 memQueue 镜像——它从不从存储水合，冷启动后第一次入队会
 * 用「仅含新事件」的镜像覆写掉上一会话的回传积压（mobile vitest 首轮实锤）；
 * 双份状态本身就是缺陷面，删除。
 */
async function loadQueue(): Promise<DiagEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DiagEvent[]) : [];
  } catch {
    return [];
  }
}

function truncate(text: string, max: number): string {
  return text.replace(/https?:\/\/\S+/g, '[url]').slice(0, max);
}

async function isDisabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(DISABLED_KEY)) === '1';
  } catch {
    return false;
  }
}

/** 入队（去重：同 kind+message 合并计数式刷新——保留最新 stack 与时间） */
export async function enqueueDiagEvent(
  kind: DiagKind,
  message: string,
  stack?: string
): Promise<void> {
  if (await isDisabled()) return;
  const norm = truncate(message || '(empty)', 600);
  const ev: DiagEvent = {
    kind,
    message: norm,
    stack: stack ? truncate(stack, 4000) : undefined,
    at: new Date().toISOString(),
  };
  const queue = await loadQueue();
  const idx = queue.findIndex((e) => e.kind === kind && e.message === norm);
  if (idx >= 0) queue.splice(idx, 1);
  queue.push(ev);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* 存储写失败静默——诊断通道本身不得成为崩溃源 */
  }
}

/**
 * 安装全局错误处理器（App.tsx 模块顶层调用一次）。
 * 覆盖未捕获异常与未处理 Promise 拒绝（RN ErrorUtils 统一入口）。
 */
export function installGlobalErrorHandler(): void {
  if (installed) return;
  installed = true;
  const ErrorUtilsApi = (
    global as {
      ErrorUtils?: {
        setGlobalHandler: (h: (e: unknown, isFatal: boolean) => void) => void;
        getGlobalHandler?: () => ((e: unknown, isFatal: boolean) => void) | undefined;
      };
    }
  ).ErrorUtils;
  if (!ErrorUtilsApi) return;
  ErrorUtilsApi.setGlobalHandler((err, isFatal) => {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    // fire-and-forget：诊断通道内部全部 catch
    void enqueueDiagEvent(isFatal ? 'error' : 'rejection', `[fatal=${isFatal}] ${message}`, stack);
    console.warn('[DustNote] uncaught error:', isFatal, message);
  });
}

function deviceInfo(): { deviceModel?: string; osVersion?: string } {
  const c = (
    Platform as unknown as {
      constants?: { Brand?: string; Model?: string; Release?: string; apiLevel?: number };
    }
  ).constants;
  if (!c) return {};
  return {
    deviceModel: [c.Brand, c.Model].filter(Boolean).join(' ') || undefined,
    osVersion: c.Release ?? (c.apiLevel != null ? `API ${c.apiLevel}` : undefined),
  };
}

let flushInFlight: Promise<void> | null = null;

/**
 * 回传本地队列（联机模式；批量 ≤20 条/请求）。
 * 成功清空已发部分；失败（含 429/网络错误）保留，下次启动或回前台再试。
 */
export function flushDiagnostics(): Promise<void> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = (async () => {
    try {
      if (await isDisabled()) return;
      const { mode, serverUrl } = useModeStore.getState();
      if (mode !== 'online' || !serverUrl) return; // 单机模式无接收方
      const queue = await loadQueue();
      if (queue.length === 0) return;
      const batch = queue.slice(-20);
      const dev = deviceInfo();
      await api.post('/diagnostics/reports', {
        events: batch.map((e) => ({
          kind: e.kind,
          message: e.message,
          stack: e.stack,
          platform: 'android' as const,
          clientVersion: APP_VERSION,
          deviceModel: dev.deviceModel,
          osVersion: dev.osVersion,
        })),
      });
      const rest = queue.slice(0, -batch.length);
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(rest));
    } catch (err) {
      // 上报失败不影响业务；保留队列下次重试（api 层错误无需分型）
      console.warn(
        '[DustNote] diagnostics flush failed:',
        err instanceof Error ? err.message : err
      );
    }
  })().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

/** 关键网络失败采样（如鉴权链路 /auth/status 失败）——今晚审计的那类信号 */
export function recordNetworkSignal(message: string): void {
  void enqueueDiagEvent('network', message).catch(() => undefined);
}
