/**
 * device.ts 测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getDeviceId, randomUuid } from './device';

describe('device', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem('dustnote_device_id');
    } catch {
      /* ignore */
    }
  });

  it('getDeviceId: 首次调用生成 UUID 写入 localStorage', () => {
    const id = getDeviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(localStorage.getItem('dustnote_device_id')).toBe(id);
  });

  it('getDeviceId: 第二次调用复用已写入的 ID', () => {
    const id1 = getDeviceId();
    const id2 = getDeviceId();
    expect(id1).toBe(id2);
  });

  it('localStorage 已有 ID → 直接复用，不重写', () => {
    localStorage.setItem('dustnote_device_id', 'fixed-id-1234');
    expect(getDeviceId()).toBe('fixed-id-1234');
  });

  it('randomUuid: 生成 UUID 格式', () => {
    const id = randomUuid();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('randomUuid: 多次生成不同', () => {
    const a = randomUuid();
    const b = randomUuid();
    expect(a).not.toBe(b);
  });
});
