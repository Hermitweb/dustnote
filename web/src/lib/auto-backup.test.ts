/**
 * auto-backup 测试
 */
import { describe, it, expect, vi } from 'vitest';

// jsdom 无 indexedDB；为 idb-keyval 装一个最简 in-memory 桩
const memoryStore = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: async (k: string) => memoryStore.get(k),
  set: async (k: string, v: unknown) => {
    memoryStore.set(k, v);
  },
  del: async (k: string) => {
    memoryStore.delete(k);
  },
  clear: async () => {
    memoryStore.clear();
  },
}));

import { getLastBackupTime, clearAutoBackups } from './auto-backup';

describe('auto-backup', () => {
  it('getLastBackupTime: 无历史 → null', async () => {
    memoryStore.clear();
    expect(await getLastBackupTime()).toBeNull();
  });

  it('getLastBackupTime: 写入后读回', async () => {
    memoryStore.clear();
    memoryStore.set('dustnote:last-auto-backup', '2026-09-25T00:00:00.000Z');
    expect(await getLastBackupTime()).toBe('2026-09-25T00:00:00.000Z');
  });

  it('clearAutoBackups 清空两条 key', async () => {
    memoryStore.set('dustnote:auto-backups', { x: 1 });
    memoryStore.set('dustnote:last-auto-backup', '2026-09-25');
    await clearAutoBackups();
    expect(memoryStore.has('dustnote:auto-backups')).toBe(false);
    expect(memoryStore.has('dustnote:last-auto-backup')).toBe(false);
  });
});
