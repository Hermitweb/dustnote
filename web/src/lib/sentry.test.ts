/**
 * web/src/lib/sentry.ts 单测 —— Sentry 初始化 / captureException / isSentryEnabled
 *
 * 注：web/vitest 用 jsdom + import.meta.env；DSN 通过 vi.stubEnv 注入。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sentry mock：测试 init 行为，不真发事件
// vi.mock 会被 hoist 到文件顶部，factory 只能用 vi.hoisted 提供的变量
const { sentryInit, sentryCapture } = vi.hoisted(() => ({
  sentryInit: vi.fn(),
  sentryCapture: vi.fn(),
}));
vi.mock('@sentry/react', () => ({
  init: sentryInit,
  captureException: sentryCapture,
  default: { init: sentryInit, captureException: sentryCapture },
}));

import { initSentry, captureException, isSentryEnabled, Sentry } from './sentry.js';

describe('sentry', () => {
  beforeEach(() => {
    sentryInit.mockReset();
    sentryCapture.mockReset();
  });

  it('无 DSN → 不初始化（no-op）', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    initSentry();
    expect(sentryInit).not.toHaveBeenCalled();
    expect(isSentryEnabled()).toBe(false);
    vi.unstubAllEnvs();
  });

  it('有 DSN → Sentry.init 被调用，initialized=true', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@sentry.example.com/1');
    vi.stubEnv('PROD', false);
    initSentry();
    expect(sentryInit).toHaveBeenCalledOnce();
    const arg = sentryInit.mock.calls[0]![0] as {
      dsn: string;
      environment: string;
      tracesSampleRate: number;
      beforeSend: (e: unknown) => unknown;
    };
    expect(arg.dsn).toBe('https://k@sentry.example.com/1');
    expect(arg.environment).toBe('development');
    expect(arg.tracesSampleRate).toBe(0);
    expect(typeof arg.beforeSend).toBe('function');
    expect(isSentryEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });

  it('PROD=true → environment=production', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@sentry.example.com/1');
    vi.stubEnv('PROD', true);
    initSentry();
    const arg = sentryInit.mock.calls[0]![0] as { environment: string };
    expect(arg.environment).toBe('production');
    vi.unstubAllEnvs();
  });

  it('beforeSend：剥离 ui.input/click 的 message + exception.value + extra', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@sentry.example.com/1');
    initSentry();
    const arg = sentryInit.mock.calls[0]![0] as { beforeSend: (e: unknown) => unknown };
    const cleaned = arg.beforeSend({
      breadcrumbs: [
        { category: 'ui.input', message: '用户输入的笔记标题明文' },
        { category: 'ui.click', message: 'clicked X' },
        { category: 'navigation', message: 'to /y' },
      ],
      exception: { values: [{ type: 'Error', value: '泄露的用户明文' }] },
      extra: { noteContent: 'note1 明文' },
    }) as {
      breadcrumbs: { category: string; message?: string }[];
      exception: { values: { value?: string }[] };
      extra: Record<string, unknown>;
    };
    expect(cleaned.breadcrumbs[0]!.message).toBeUndefined();
    expect(cleaned.breadcrumbs[1]!.message).toBeUndefined();
    expect(cleaned.breadcrumbs[2]!.message).toBe('to /y');
    expect(cleaned.exception.values[0]!.value).toBeUndefined();
    expect(cleaned.extra).toEqual({});
  });

  it('beforeSend：缺字段时也安全（不抛）', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@sentry.example.com/1');
    initSentry();
    const arg = sentryInit.mock.calls[0]![0] as { beforeSend: (e: unknown) => unknown };
    expect(() => arg.beforeSend({})).not.toThrow();
    expect(() => arg.beforeSend({ breadcrumbs: undefined })).not.toThrow();
  });

  it('captureException：未初始化时 no-op', async () => {
    // 隔离模块加载，确保 initialized 状态为 false
    vi.resetModules();
    const { captureException: cap, isSentryEnabled: isOn } = await import('./sentry.js');
    expect(isOn()).toBe(false);
    cap(new Error('boom'));
    expect(sentryCapture).not.toHaveBeenCalled();
  });

  it('captureException：初始化后透传到 Sentry', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@sentry.example.com/1');
    initSentry();
    const e = new Error('boom');
    captureException(e);
    expect(sentryCapture).toHaveBeenCalledWith(e);
    vi.unstubAllEnvs();
  });

  it('Sentry re-export（调用方可用 Sentry.x）', () => {
    expect(Sentry).toBeDefined();
    expect(typeof Sentry.init).toBe('function');
  });
});
