/**
 * config.ts 测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CONFIG_DEFAULTS,
  loadConfig,
  getConfig,
  saveConfig,
  resetConfigStorage,
  generatePlatformConfig,
  downloadConfig,
} from './config';

describe('config', () => {
  beforeEach(() => {
    localStorage.clear();
    resetConfigStorage();
  });

  it('CONFIG_DEFAULTS 出厂值', () => {
    expect(CONFIG_DEFAULTS.apiBase).toBe('/api/v1');
    expect(CONFIG_DEFAULTS.appName).toBe('DustNote');
    expect(CONFIG_DEFAULTS.customized).toBe(false);
  });

  it('getConfig 未初始化时返回默认值', () => {
    resetConfigStorage();
    expect(getConfig().apiBase).toBe('/api/v1');
  });

  it('loadConfig: 无 config.json → 返回默认值', async () => {
    // jsdom fetch 默认抛错；mock 让它 resolve null
    global.fetch = vi.fn(
      async () => new Response('not-found', { status: 404 })
    ) as unknown as typeof fetch;
    const cfg = await loadConfig();
    expect(cfg.apiBase).toBe('/api/v1');
    expect(cfg.appName).toBe('DustNote');
  });

  it('saveConfig: 更新配置并持久化到 localStorage', () => {
    const cfg = saveConfig({ apiBase: 'https://api.example.com/v1', appName: '我的笔记' });
    expect(cfg.apiBase).toBe('https://api.example.com/v1');
    expect(cfg.appName).toBe('我的笔记');
    expect(cfg.customized).toBe(true);
    const raw = localStorage.getItem('dustnote_app_config');
    expect(raw).toContain('https://api.example.com/v1');
  });

  it('resetConfigStorage 清除缓存', () => {
    saveConfig({ apiBase: 'x' });
    resetConfigStorage();
    expect(getConfig().apiBase).toBe('/api/v1');
  });

  it('generatePlatformConfig: desktop / web 输出 JSON', () => {
    const out = generatePlatformConfig('desktop');
    expect(out).toContain('"platform": "desktop"');
  });

  it('generatePlatformConfig: miniprogram 输出常量声明', () => {
    const out = generatePlatformConfig('miniprogram');
    expect(out).toContain('API_BASE');
  });

  it('generatePlatformConfig: ios 输出带 miniprogramAppId', () => {
    const out = generatePlatformConfig('ios');
    expect(out).toContain('miniprogramAppId');
  });

  it('downloadConfig: 触发下载', () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    downloadConfig('test.json', '{}');
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
  });
});
