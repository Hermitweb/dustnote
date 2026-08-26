/**
 * env.ts 环境能力检测单元测试
 *
 * 用 vi.stubGlobal 模拟不同环境（HTTPS / HTTP 公网 / localhost / 无 API），
 * 验证检测逻辑的正确性——这些检测是所有降级方案（copyText / SW 注册 /
 * 读剪贴板预检）的基石。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 每个用例重新加载模块，保证模块级常量按 stub 后的环境重新求值
async function loadEnv() {
  vi.resetModules();
  return await import('./env');
}

describe('env 能力检测', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('HTTPS 安全上下文：全能力可用', async () => {
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', {
      clipboard: { readText: () => Promise.resolve(''), writeText: () => Promise.resolve() },
      serviceWorker: {},
    });
    const env = await loadEnv();
    expect(env.isSecureContext).toBe(true);
    expect(env.isPlainHttp).toBe(false);
    expect(env.canReadClipboard).toBe(true);
    expect(env.canRegisterServiceWorker).toBe(true);
  });

  it('HTTP 公网 IP（非安全上下文）：受限能力全部正确识别为不可用', async () => {
    vi.stubGlobal('window', { isSecureContext: false });
    // 模拟真实浏览器：HTTP 下 navigator.clipboard 为 undefined
    vi.stubGlobal('navigator', { serviceWorker: {} });
    vi.stubGlobal('location', { protocol: 'http:', hostname: '154.217.234.125' });
    const env = await loadEnv();
    expect(env.isSecureContext).toBe(false);
    expect(env.isPlainHttp).toBe(true);
    expect(env.canReadClipboard).toBe(false);
    expect(env.canRegisterServiceWorker).toBe(false);
  });

  it('HTTP localhost：受限但不算明文公网直连', async () => {
    vi.stubGlobal('window', { isSecureContext: false });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('location', { protocol: 'http:', hostname: 'localhost' });
    const env = await loadEnv();
    expect(env.isPlainHttp).toBe(false);
  });

  it('jsdom 等无部分 API 的环境：检测不抛异常', async () => {
    vi.stubGlobal('window', { isSecureContext: false });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('location', { protocol: 'http:', hostname: 'example.com' });
    const env = await loadEnv();
    expect(env.canReadClipboard).toBe(false);
    expect(env.canRegisterServiceWorker).toBe(false);
  });
});
