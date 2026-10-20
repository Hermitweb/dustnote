/**
 * web/src/lib/db.ts 单测 —— IndexedDB 缓存层（明文用 localKey 加密）
 *
 * fake-indexeddb 通过 web/test-setup 已注入。涉及 offline-queue / diagnostics /
 * auto-backup 的 dynamic imports 走 vi.mock 隔离。
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { randomBytes } from '@dustnote/shared';
import type { NoteRow, NotePlaintext, Folder } from './store';

vi.mock('./offline-queue', () => ({ clear: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./diagnostics', () => ({ clearLogs: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./auto-backup', () => ({ clearAutoBackups: vi.fn().mockResolvedValue(undefined) }));

import {
  cacheNotes,
  loadCachedNotes,
  cacheFolders,
  loadCachedFolders,
  clearCache,
  clearPlainCache,
  getStorageUsage,
  cleanupCache,
} from './db.js';

const KEYS = {
  notes: 'dustnote:notes',
  notesPlain: 'dustnote:notes-plain',
  folders: 'dustnote:folders',
} as const;

async function resetIdb(): Promise<void> {
  await Promise.all([idbDel(KEYS.notes), idbDel(KEYS.notesPlain), idbDel(KEYS.folders)]);
}

function makeRow(id: string, ct: string): [string, NoteRow] {
  return [
    id,
    {
      id,
      ciphertext: ct,
      keyVersion: 1,
      isPinned: false,
      isFavorite: false,
      deletedAt: null,
      version: 1,
      clientUpdatedAt: '2026-01-01',
      serverUpdatedAt: '2026-01-01',
      folderId: null,
    },
  ];
}
function makePlain(id: string, title: string): [string, NotePlaintext] {
  // NotePlaintext 的 tags 是必填字段，补齐后仍是同一条明文缓存记录
  return [id, { title, content: 'body', tags: [] }];
}

describe('web db cache', () => {
  beforeEach(async () => {
    await resetIdb();
  });

  describe('cacheNotes / loadCachedNotes', () => {
    it('无 localKey → 密文落库 + 明文缓存被清空', async () => {
      const notes = new Map([makeRow('n-1', 'cipher-1')]);
      const plain = new Map([makePlain('n-1', 'title-1')]);
      await cacheNotes(notes, plain);
      // 密文已存
      const notesArr = await idbGet<[string, NoteRow][]>(KEYS.notes);
      expect(notesArr?.[0]?.[0]).toBe('n-1');
      // 明文缓存被删（无密钥不落明文）
      const plainBlob = await idbGet(KEYS.notesPlain);
      expect(plainBlob).toBeUndefined();
    });

    it('有 localKey → 明文被加密落盘，loadCachedNotes + localKey 还原', async () => {
      const localKey = randomBytes(32);
      const notes = new Map([makeRow('n-1', 'cipher-1')]);
      const plain = new Map([makePlain('n-1', '尘渊'), makePlain('n-2', 'hello')]);
      await cacheNotes(notes, plain, localKey);
      const got = await loadCachedNotes(localKey);
      expect(got.notes.size).toBe(1);
      expect(got.notes.get('n-1')?.ciphertext).toBe('cipher-1');
      expect(got.plain.size).toBe(2);
      expect(got.plain.get('n-1')?.title).toBe('尘渊');
      expect(got.plain.get('n-2')?.title).toBe('hello');
    });

    it('loadCachedNotes 无 localKey → 明文为空（不泄露密文）', async () => {
      const localKey = randomBytes(32);
      const notes = new Map([makeRow('n-1', 'c')]);
      const plain = new Map([makePlain('n-1', 'secret')]);
      await cacheNotes(notes, plain, localKey);
      const got = await loadCachedNotes(); // 无 key
      expect(got.notes.size).toBe(1);
      expect(got.plain.size).toBe(0);
    });

    it('loadCachedNotes 错 key → 明文空，密文仍可用（不抛、不降级为明文）', async () => {
      const localKey = randomBytes(32);
      const wrongKey = randomBytes(32);
      const notes = new Map([makeRow('n-1', 'c')]);
      const plain = new Map([makePlain('n-1', 'secret')]);
      await cacheNotes(notes, plain, localKey);
      const got = await loadCachedNotes(wrongKey);
      expect(got.notes.size).toBe(1);
      expect(got.plain.size).toBe(0);
    });

    it('loadCachedNotes 旧明文（plain 是数组不是 Ciphertext）→ 当作无 plain 处理', async () => {
      // 模拟历史格式：[string, NotePlaintext][]
      const localKey = randomBytes(32);
      const oldFormat = [['n-1', { title: 'old', content: 'x' }]];
      await idbSet(KEYS.notesPlain, oldFormat);
      const got = await loadCachedNotes(localKey);
      expect(got.plain.size).toBe(0);
    });

    it('loadCachedNotes 密文不存在 → 空 Map', async () => {
      const got = await loadCachedNotes();
      expect(got.notes.size).toBe(0);
      expect(got.plain.size).toBe(0);
    });
  });

  describe('cacheFolders / loadCachedFolders', () => {
    it('空 → load 返回 []', async () => {
      expect(await loadCachedFolders()).toEqual([]);
    });

    it('cache + load 往返', async () => {
      const folders: Folder[] = [
        {
          id: 'f-1',
          name: 'A',
          parentId: null,
          icon: null,
          sortOrder: 0,
          depth: 1,
          branch: 'work',
          createdAt: '2026-01-01',
        },
        {
          id: 'f-2',
          name: 'B',
          parentId: 'f-1',
          icon: null,
          sortOrder: 0,
          depth: 2,
          branch: 'work',
          createdAt: '2026-01-01',
        },
      ];
      await cacheFolders(folders);
      const got = await loadCachedFolders();
      expect(got).toEqual(folders);
    });
  });

  describe('clearCache / clearPlainCache', () => {
    it('clearCache → 三个 key 全清', async () => {
      await idbSet(KEYS.notes, [
        [
          'n-1',
          {
            id: 'n-1',
            ciphertext: 'c',
            keyVersion: 1,
            isPinned: false,
            isFavorite: false,
            deletedAt: null,
            version: 1,
            clientUpdatedAt: '2026-01-01',
            serverUpdatedAt: '2026-01-01',
            folderId: null,
          },
        ],
      ]);
      await idbSet(KEYS.notesPlain, { v: 1, k: 1, n: 'x', c: 'y' });
      await idbSet(KEYS.folders, []);
      await clearCache();
      expect(await idbGet(KEYS.notes)).toBeUndefined();
      expect(await idbGet(KEYS.notesPlain)).toBeUndefined();
      expect(await idbGet(KEYS.folders)).toBeUndefined();
    });

    it('clearPlainCache → 仅清明文，密文+文件夹保留', async () => {
      const localKey = randomBytes(32);
      const notes = new Map([makeRow('n-1', 'c')]);
      const plain = new Map([makePlain('n-1', 'secret')]);
      await cacheNotes(notes, plain, localKey);
      await cacheFolders([]);
      await clearPlainCache();
      expect(await idbGet(KEYS.notes)).toBeDefined();
      expect(await idbGet(KEYS.notesPlain)).toBeUndefined();
      expect(await idbGet(KEYS.folders)).toBeDefined();
    });
  });

  describe('getStorageUsage', () => {
    it('无 navigator.storage.estimate → 返回 0/0/0（jsdom 默认）', async () => {
      const r = await getStorageUsage();
      expect(r).toEqual({ usage: 0, quota: 0, usagePercent: 0 });
    });

    it('estimate 返回具体值 → usagePercent 正确计算', async () => {
      Object.defineProperty(navigator, 'storage', {
        value: { estimate: async () => ({ usage: 25, quota: 100 }) },
        configurable: true,
      });
      const r = await getStorageUsage();
      expect(r.usage).toBe(25);
      expect(r.quota).toBe(100);
      expect(r.usagePercent).toBe(25);
      // 还原 navigator.storage
      Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
    });
  });

  describe('cleanupCache', () => {
    it('清理离线队列 + 诊断日志 + 自动备份（不动笔记）', async () => {
      const notes = new Map([makeRow('n-1', 'c')]);
      await cacheNotes(notes, new Map(), randomBytes(32));
      const r = await cleanupCache();
      expect(r.cleared).toEqual(['offline-queue', 'diagnostics', 'auto-backups']);
      // 笔记仍在
      expect((await idbGet(KEYS.notes))?.[0]?.[0]).toBe('n-1');
    });
  });
});
