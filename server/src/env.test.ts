/**
 * server/src/env.ts 单测 —— config 对象各字段
 *
 * env.ts 是模块级 `export const config = {...}`，import 时求值。
 * 测试通过 vi.resetModules + mock process.env + 动态 import 驱动。
 */
import { describe, it, expect, vi, afterAll } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

function loadEnv(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  // 清除 config.js 的副作用（.env 加载）
  vi.doMock('./config.js', () => ({}));
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import('./env.js');
}

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('env.ts config', () => {
  it('默认值：nodeEnv=development / port=3210 / logLevel=info', async () => {
    const { config } = await loadEnv({
      NODE_ENV: 'development',
      PORT: '',
      LOG_LEVEL: '',
    });
    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3210);
    expect(config.logLevel).toBe('info');
  });

  it('PORT 自定义', async () => {
    const { config } = await loadEnv({ PORT: '9999' });
    expect(config.port).toBe(9999);
  });

  it('cookieSecure：生产默认 true / 显式 COOKIE_SECURE=false 覆盖', async () => {
    const prod = await loadEnv({
      NODE_ENV: 'production',
      COOKIE_SECURE: undefined,
      JWT_SECRET: 'a'.repeat(48),
    });
    expect(prod.config.cookieSecure).toBe(true);

    const overridden = await loadEnv({
      NODE_ENV: 'production',
      COOKIE_SECURE: 'false',
      JWT_SECRET: 'a'.repeat(48),
    });
    expect(overridden.config.cookieSecure).toBe(false);
  });

  it('cookieSecure：开发默认 false / 显式 COOKIE_SECURE=true 覆盖', async () => {
    const dev = await loadEnv({ NODE_ENV: 'development', COOKIE_SECURE: undefined });
    expect(dev.config.cookieSecure).toBe(false);

    const overridden = await loadEnv({
      NODE_ENV: 'development',
      COOKIE_SECURE: 'true',
    });
    expect(overridden.config.cookieSecure).toBe(true);
  });

  it('metricsEnabled / metricsToken', async () => {
    const on = await loadEnv({ METRICS_ENABLED: 'true', METRICS_TOKEN: 'tok' });
    expect(on.config.metricsEnabled).toBe(true);
    expect(on.config.metricsToken).toBe('tok');

    const off = await loadEnv({ METRICS_ENABLED: undefined, METRICS_TOKEN: undefined });
    expect(off.config.metricsEnabled).toBe(false);
    expect(off.config.metricsToken).toBeNull();
  });

  it('trustProxy 默认 0 / 自定义 1', async () => {
    const def = await loadEnv({ TRUST_PROXY: undefined });
    expect(def.config.trustProxy).toBe(0);
    const one = await loadEnv({ TRUST_PROXY: '1' });
    expect(one.config.trustProxy).toBe(1);
  });

  it('backupRetention 默认 30 / 自定义 10', async () => {
    const def = await loadEnv({ BACKUP_RETENTION: undefined });
    expect(def.config.backupRetention).toBe(30);
    const ten = await loadEnv({ BACKUP_RETENTION: '10' });
    expect(ten.config.backupRetention).toBe(10);
  });

  it('serverPublicUrl / downloadPageUrl / forceUpdateVersion 留空为 null', async () => {
    const { config } = await loadEnv({
      SERVER_PUBLIC_URL: undefined,
      DOWNLOAD_PAGE_URL: undefined,
      FORCE_UPDATE_VERSION: undefined,
    });
    expect(config.serverPublicUrl).toBeNull();
    expect(config.downloadPageUrl).toBeNull();
    expect(config.forceUpdateVersion).toBeNull();
  });

  it('生产环境 JWT_SECRET 默认值 → 拒绝启动', async () => {
    vi.resetModules();
    vi.doMock('./config.js', () => ({}));
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    await expect(import('./env.js')).rejects.toThrow('必须设置 JWT_SECRET');
  });

  it('生产环境 JWT_SECRET 过短（< 32）→ 拒绝启动', async () => {
    vi.resetModules();
    vi.doMock('./config.js', () => ({}));
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'short-secret';
    await expect(import('./env.js')).rejects.toThrow('长度不足');
  });

  it('生产环境 JWT_SECRET 合规 → 通过', async () => {
    vi.resetModules();
    vi.doMock('./config.js', () => ({}));
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(48);
    const { config } = await import('./env.js');
    expect(config.jwtSecret).toBe('a'.repeat(48));
  });
});
