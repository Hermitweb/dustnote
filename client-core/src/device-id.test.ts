/**
 * device-id 测试 —— 跨端 deviceId 的 get-or-generate 语义
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEVICE_ID_KEY,
  createDeviceIdStore,
  randomUuid,
  type DeviceIdStorage,
} from './device-id.js';

/** 内存版存储（模拟 localStorage / AsyncStorage）。 */
function memStorage(initial?: string): DeviceIdStorage & { data: Record<string, string> } {
  const data: Record<string, string> = initial ? { [DEVICE_ID_KEY]: initial } : {};
  return {
    data,
    get(key) {
      return data[key] ?? null;
    },
    set(key, value) {
      data[key] = value;
    },
  };
}

describe('device-id', () => {
  describe('randomUuid', () => {
    it('生成标准 UUID v4 形状（8-4-4-4-12 + 13 位为 4, 17 位为 8-11）', () => {
      const id = randomUuid();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('每次调用产出不同 id（统计 64 次无碰撞）', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 64; i++) seen.add(randomUuid());
      expect(seen.size).toBe(64);
    });

    it('crypto.getRandomValues 不可用时回退到 Math.random，仍产 UUID 形状', () => {
      const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
      try {
        // Node 20+ 上 globalThis.crypto 是 getter-only，用 defineProperty 覆盖
        Object.defineProperty(globalThis, 'crypto', {
          value: { getRandomValues: undefined },
          configurable: true,
          writable: true,
        });
        const id = randomUuid();
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      } finally {
        if (original) Object.defineProperty(globalThis, 'crypto', original);
        else Reflect.deleteProperty(globalThis, 'crypto');
      }
    });
  });

  describe('createDeviceIdStore', () => {
    let storage: ReturnType<typeof memStorage>;
    beforeEach(() => {
      storage = memStorage();
    });

    it('存储为空 → 首次调用生成并落库，后续调用命中存储', () => {
      const getId = createDeviceIdStore(storage);
      const first = getId();
      expect(first).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(storage.data[DEVICE_ID_KEY]).toBe(first);

      const second = getId();
      expect(second).toBe(first); // 命中存储：稳定
    });

    it('存储已有值 → 直接返回，不重新生成', () => {
      const existing = '11111111-2222-4333-8444-555555555555';
      storage = memStorage(existing);
      const getId = createDeviceIdStore(storage);
      expect(getId()).toBe(existing);
      expect(getId()).toBe(existing);
      // 不会用新值覆盖
      expect(storage.data[DEVICE_ID_KEY]).toBe(existing);
    });

    it('存储 set 抛错时仍返回本次生成的 id（不阻断）', () => {
      const broken: DeviceIdStorage = {
        get: () => null,
        set: () => {
          throw new Error('QuotaExceededError');
        },
      };
      const getId = createDeviceIdStore(broken);
      const id = getId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('多次调用 getId 同实例 → 始终返回同一 id（无并发干扰）', () => {
      const getId = createDeviceIdStore(storage);
      const ids = new Set<string>();
      for (let i = 0; i < 20; i++) ids.add(getId());
      expect(ids.size).toBe(1);
    });
  });
});
