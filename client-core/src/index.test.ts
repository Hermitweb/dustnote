/**
 * client-core 入口（index.ts）冒烟测试 —— 验证所有公开 API 都从 barrel 正确导出
 *
 * index.ts 是纯 re-export 聚合，本身没逻辑可断言；这里只做"导入即用"的契约
 * 测试——保证后续重构时哪个被 export/被误删，CI 立刻报警。
 */
import { describe, it, expect } from 'vitest';
import * as core from './index.js';
import { DEVICE_ID_KEY, randomUuid, createDeviceIdStore } from './index.js';
import type { DeviceIdStorage } from './index.js';

describe('client-core barrel (index.ts) 导出契约', () => {
  it('device-id 系列导出可用', () => {
    expect(typeof DEVICE_ID_KEY).toBe('string');
    expect(typeof randomUuid).toBe('function');
    expect(typeof createDeviceIdStore).toBe('function');

    const storage: DeviceIdStorage = { get: () => null, set: () => undefined };
    const getId = createDeviceIdStore(storage);
    expect(getId()).toMatch(/^[0-9a-f]{8}-/);
  });

  it('核心类型 + 适配器 + i18n 全部从 barrel 可见', () => {
    // 值
    expect(typeof core.sharedCryptoBackend).toBe('object');
    expect(typeof core.ENVELOPE_VERSION).toBe('number');
    expect(typeof core.MAX_RETRIES).toBe('number');
    expect(typeof core.DEFAULT_LANGUAGE).toBe('string');
    expect(typeof core.LANGUAGE_STORAGE_KEY).toBe('string');
    expect(typeof core.SUPPORTED_LANGUAGES).toBe('object');
    expect(typeof core.FALLBACK_LANGUAGE).toBe('string');
    expect(typeof core.MODE_STORAGE_KEY).toBe('string');
    expect(typeof core.DEFAULT_MODE_STATE).toBe('object');
    // 类
    expect(typeof core.MemoryQueueStorage).toBe('function');
    expect(typeof core.OfflineQueue).toBe('function');
    expect(typeof core.SyncEngine).toBe('function');
    expect(typeof core.RemoteRepository).toBe('function');
    // 函数
    expect(typeof core.getCryptoBackend).toBe('function');
    expect(typeof core.setCryptoBackend).toBe('function');
    expect(typeof core.encryptNote).toBe('function');
    expect(typeof core.decryptNote).toBe('function');
    expect(typeof core.parseEnvelope).toBe('function');
    expect(typeof core.resolveConflict).toBe('function');
    expect(typeof core.toMergeable).toBe('function');
    expect(typeof core.getRetryDelay).toBe('function');
    expect(typeof core.isAppLanguage).toBe('function');
    expect(typeof core.resolveDictKey).toBe('function');
    expect(typeof core.interpolate).toBe('function');
    expect(typeof core.createTranslator).toBe('function');
    expect(typeof core.createConflictStore).toBe('function');
    expect(typeof core.createModeStore).toBe('function');
    expect(typeof core.toModeState).toBe('function');
  });
});
