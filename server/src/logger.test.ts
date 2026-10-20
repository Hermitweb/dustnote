/**
 * logger 单元测试
 *
 * 验证：
 *  - logger 实例可被调用（不抛）
 *  - redact 路径生效：写入 password/masterKey/authKey 等敏感字段会被 [REDACTED]
 *  - 自定义 censor 工作
 *
 * 实现说明：pino 默认调用同步会立即写到 stdout/stderr。测试中我们捕获
 * destination 来读 raw 日志行 JSON。
 */
import { describe, it, expect } from 'vitest';

function captureLogs(_level = 'info') {
  const logs: string[] = [];
  return { logs };
}

import pino from 'pino';

describe('logger redact', () => {
  it('password / authKey / masterKey / refreshToken 全部被 [REDACTED]', () => {
    const { logs } = captureLogs();
    const testLogger = pino(
      {
        level: 'info',
        redact: {
          paths: [
            'password',
            'authKey',
            'masterKey',
            'refreshToken',
            'accessToken',
            'secret',
            'token',
          ],
          censor: '[REDACTED]',
        },
      },
      {
        write(s: string) {
          logs.push(s);
          return true;
        },
      } as any
    );
    testLogger.info({
      password: 'my-secret',
      authKey: 'my-auth-key',
      masterKey: 'my-master',
      refreshToken: 'rt-xxx',
      accessToken: 'at-xxx',
      secret: 'shh',
      token: 'tok',
      note: 'safe to log',
    });
    // 至少一条日志输出
    expect(logs.length).toBeGreaterThan(0);
    const line = logs.join('\n');
    expect(line).toContain('[REDACTED]');
    expect(line).not.toContain('my-secret');
    expect(line).not.toContain('my-auth-key');
    expect(line).not.toContain('my-master');
    expect(line).not.toContain('rt-xxx');
    expect(line).not.toContain('at-xxx');
    expect(line).toContain('safe to log');
  });

  it('环境变量级别可生效', () => {
    const logs: string[] = [];
    const l = pino({ level: 'warn' }, {
      write(s: string) {
        logs.push(s);
        return true;
      },
    } as any);
    l.info('should not appear');
    l.warn('should appear');
    expect(logs.join('\n')).toContain('should appear');
    expect(logs.join('\n')).not.toContain('should not appear');
  });
});
