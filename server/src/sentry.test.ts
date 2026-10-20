/**
 * Sentry 初始化单元测试
 *
 * 验证：
 *  - 未配置 DSN → initSentry 是 no-op，captureException 也是 no-op
 *  - 配置 DSN → Sentry.init 被调用
 *  - setupSentryErrorHandler 在未初始化时是 no-op
 *  - beforeSend 钩子剥离敏感字段
 *
 * 注：sentry.ts 在 import 时可能执行 logger.info，与 vitest 自定义 console level
 * 冲突。本测试使用 vi.mock 把 logger 静默后再触发 import。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const initMock = vi.fn();
const setupHandlerMock = vi.fn();
const captureMock = vi.fn();

vi.mock('@sentry/node', () => ({
  init: (...args: unknown[]) => initMock(...args),
  setupExpressErrorHandler: (...args: unknown[]) => setupHandlerMock(...args),
  captureException: (...args: unknown[]) => captureMock(...args),
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));

const configMock = {
  sentryDsn: undefined as string | undefined,
  nodeEnv: 'test',
  serverVersion: '9.9.9-test',
};

vi.mock('./env.js', () => ({
  get config() {
    return configMock;
  },
}));

const sentry = await import('./sentry.js');

describe('Sentry init (no DSN)', () => {
  beforeEach(() => {
    initMock.mockClear();
    setupHandlerMock.mockClear();
    captureMock.mockClear();
  });

  it('initSentry() 在 DSN 未配置时是 no-op（不调 Sentry.init）', () => {
    configMock.sentryDsn = undefined;
    sentry.initSentry();
    expect(initMock).not.toHaveBeenCalled();
  });

  it('captureException() 在未初始化时是 no-op', () => {
    configMock.sentryDsn = undefined;
    sentry.captureException(new Error('boom'));
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('setupSentryErrorHandler() 在未初始化时是 no-op', () => {
    configMock.sentryDsn = undefined;
    sentry.setupSentryErrorHandler({} as any);
    expect(setupHandlerMock).not.toHaveBeenCalled();
  });
});

describe('Sentry init (with DSN)', () => {
  beforeEach(() => {
    initMock.mockClear();
    setupHandlerMock.mockClear();
    captureMock.mockClear();
    configMock.sentryDsn = undefined;
  });

  it('DSN 配置时 initSentry() 调用 Sentry.init', () => {
    configMock.sentryDsn = 'https://public@example.com/1';
    sentry.initSentry();
    expect(initMock).toHaveBeenCalledOnce();
    const arg = initMock.mock.calls[0]![0];
    expect(arg.dsn).toBe('https://public@example.com/1');
    expect(arg.environment).toBe('test');
    expect(arg.release).toBe('dustnote-server@9.9.9-test');
    expect(arg.tracesSampleRate).toBe(0);
    expect(typeof arg.beforeSend).toBe('function');
  });

  it('beforeSend 剥离敏感字段（data / cookies / 除 UA 外的 header）', () => {
    configMock.sentryDsn = 'https://public@example.com/1';
    sentry.initSentry();
    const beforeSend = initMock.mock.calls[0]![0].beforeSend;
    const event: any = {
      request: {
        url: '/foo',
        method: 'POST',
        data: { ciphertext: 'long-ciphertext' },
        cookies: { session: 'cookie-value' },
        headers: { 'user-agent': 'jest', authorization: 'Bearer xxx' },
      },
    };
    const out = beforeSend(event);
    expect(out.request.data).toBeUndefined();
    expect(out.request.cookies).toBeUndefined();
    expect(out.request.headers).toEqual({ 'user-agent': 'jest' });
  });

  it('setupSentryErrorHandler() 在已初始化时挂载 handler', () => {
    configMock.sentryDsn = 'https://public@example.com/1';
    sentry.initSentry();
    sentry.setupSentryErrorHandler({} as any);
    expect(setupHandlerMock).toHaveBeenCalledOnce();
  });
});
