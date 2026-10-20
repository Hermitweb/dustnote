/**
 * web/src/lib/local-repo.ts 单测 —— IndexedDB 持久化的 DataRepository
 *
 * 使用 fake-indexeddb 让 idb-keyval 在 jsdom 跑得通（已通过 web/test-setup.ts 注入）。
 * 不依赖 React/store 层——纯 IO 行为。
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { LocalRepository } from './local-repo.js';
import type { NoteRow, Folder, Tag, BackupPayload, Preferences } from '@dustnote/shared';
import { del as idbDel, get as idbGet } from 'idb-keyval';

const KEYS = {
  notes: 'dustnote:local:notes',
  folders: 'dustnote:local:folders',
  tags: 'dustnote:local:tags',
  preferences: 'dustnote:local:preferences',
} as const;

async function resetIdb(): Promise<void> {
  await Promise.all([
    idbDel(KEYS.notes),
    idbDel(KEYS.folders),
    idbDel(KEYS.tags),
    idbDel(KEYS.preferences),
  ]);
}

/**
 * setPreferences 的入参类型是 Partial<Preferences>（生产类型里 theme 是 ThemeId 枚举、
 * 语言字段名是 language）。这几条用例故意写入 'dark' / 'lang' 这类非规范值，
 * 用来验证「仓库原样 merge、不过滤字段」的合并语义——运行时写入的值与断言完全不变，
 * 故这里用两段式断言绕过类型检查，而不是把用例数据改成规范值（那会改变断言语义）。
 */
function rawPrefs(p: Record<string, unknown>): Partial<Preferences> {
  return p as unknown as Partial<Preferences>;
}

describe('LocalRepository', () => {
  let repo: LocalRepository;
  beforeEach(async () => {
    await resetIdb();
    repo = new LocalRepository();
  });

  describe('kind + loadAll', () => {
    it('kind === "local"', () => {
      expect(repo.kind).toBe('local');
    });
    it('空 IDB → loadAll 返回空快照（preferences=null）', async () => {
      const snap = await repo.loadAll();
      expect(snap).toEqual({ notes: [], folders: [], tags: [], preferences: null });
    });
  });

  describe('createNote / updateNote / deleteNote / restoreNote', () => {
    it('createNote → 写库 + 返回 id + version=1 + defaults 合理', async () => {
      const id = await repo.createNote({ ciphertext: 'c1', keyVersion: 1 });
      const all = await idbGet<NoteRow[]>(KEYS.notes);
      expect(all?.length).toBe(1);
      const n = all![0]!;
      expect(n.id).toBe(id);
      expect(n.ciphertext).toBe('c1');
      expect(n.version).toBe(1);
      expect(n.deletedAt).toBeNull();
      expect(n.isPinned).toBe(false);
      expect(n.isFavorite).toBe(false);
      expect(n.folderId).toBeNull();
      expect(typeof n.clientUpdatedAt).toBe('string');
    });

    it('createNote 接受客户端预生成 id（用作 AAD 绑定）', async () => {
      const id = await repo.createNote({ id: 'preset-id-1', ciphertext: 'c', keyVersion: 1 });
      expect(id).toBe('preset-id-1');
    });

    it('createNote 接受 isPinned/isFavorite/folderId', async () => {
      await repo.createNote({
        ciphertext: 'c',
        keyVersion: 1,
        isPinned: true,
        isFavorite: true,
        folderId: 'f-1',
      });
      const all = await idbGet<NoteRow[]>(KEYS.notes);
      expect(all![0]!.isPinned).toBe(true);
      expect(all![0]!.isFavorite).toBe(true);
      expect(all![0]!.folderId).toBe('f-1');
    });

    it('updateNote：version 自增 + 字段合并', async () => {
      const id = await repo.createNote({ ciphertext: 'old', keyVersion: 1 });
      const v2 = await repo.updateNote(id, { ciphertext: 'new' });
      expect(v2).toBe(2);
      const all = await idbGet<NoteRow[]>(KEYS.notes);
      expect(all![0]!.ciphertext).toBe('new');
      expect(all![0]!.version).toBe(2);
    });

    it('updateNote：只更新传入字段（其它保持）', async () => {
      const id = await repo.createNote({
        ciphertext: 'c',
        keyVersion: 1,
        isPinned: true,
        isFavorite: true,
      });
      await repo.updateNote(id, { isFavorite: false });
      const n = (await idbGet<NoteRow[]>(KEYS.notes))![0]!;
      expect(n.isPinned).toBe(true); // 不动
      expect(n.isFavorite).toBe(false); // 改了
    });

    it('updateNote：笔记不存在 → 抛 "Note not found"', async () => {
      await expect(repo.updateNote('nonexistent', { isPinned: true })).rejects.toThrow(/not found/);
    });

    it('deleteNote → 软删（deletedAt 设时间戳）', async () => {
      const id = await repo.createNote({ ciphertext: 'c', keyVersion: 1 });
      await repo.deleteNote(id);
      const n = (await idbGet<NoteRow[]>(KEYS.notes))![0]!;
      expect(n.deletedAt).not.toBeNull();
      expect(n.version).toBe(2);
    });

    it('restoreNote → deletedAt 置 null', async () => {
      const id = await repo.createNote({ ciphertext: 'c', keyVersion: 1 });
      await repo.deleteNote(id);
      await repo.restoreNote(id);
      const n = (await idbGet<NoteRow[]>(KEYS.notes))![0]!;
      expect(n.deletedAt).toBeNull();
    });

    it('permanentDeleteNote → 行消失', async () => {
      const id = await repo.createNote({ ciphertext: 'c', keyVersion: 1 });
      await repo.permanentDeleteNote(id);
      const all = await idbGet<NoteRow[]>(KEYS.notes);
      expect(all).toEqual([]);
    });

    it('moveNote → folderId 更新', async () => {
      const id = await repo.createNote({ ciphertext: 'c', keyVersion: 1 });
      await repo.moveNote(id, 'f-x');
      const n = (await idbGet<NoteRow[]>(KEYS.notes))![0]!;
      expect(n.folderId).toBe('f-x');
    });

    it('emptyTrash → 仅删 deletedAt 非空的', async () => {
      const a = await repo.createNote({ ciphertext: 'a', keyVersion: 1 });
      await repo.createNote({ ciphertext: 'b', keyVersion: 1 });
      await repo.deleteNote(a);
      await repo.emptyTrash();
      const all = await idbGet<NoteRow[]>(KEYS.notes);
      expect(all?.length).toBe(1);
      expect(all![0]!.ciphertext).toBe('b');
    });
  });

  describe('createFolder / rename / move / delete（级联）', () => {
    it('createFolder → sortOrder = 当前长度', async () => {
      const id1 = await repo.createFolder({ name: 'A' });
      const id2 = await repo.createFolder({ name: 'B' });
      const all = await idbGet<Folder[]>(KEYS.folders);
      expect(all![0]!.sortOrder).toBe(0);
      expect(all![1]!.sortOrder).toBe(1);
      expect(all![0]!.id).toBe(id1);
      expect(all![1]!.id).toBe(id2);
    });

    it('createFolder 父级 → depth = parent.depth + 1 + branch 继承', async () => {
      const parent = await repo.createFolder({ name: 'parent' });
      const child = await repo.createFolder({ name: 'child', parentId: parent });
      const all = await idbGet<Folder[]>(KEYS.folders);
      const c = all!.find((f) => f.id === child)!;
      expect(c.depth).toBe(2);
    });

    it('renameFolder → 仅改 name', async () => {
      const id = await repo.createFolder({ name: 'old' });
      await repo.renameFolder(id, 'new');
      const all = await idbGet<Folder[]>(KEYS.folders);
      expect(all![0]!.name).toBe('new');
    });

    it('moveFolder → depth/branch 重新计算', async () => {
      const a = await repo.createFolder({ name: 'a' });
      const b = await repo.createFolder({ name: 'b' });
      const child = await repo.createFolder({ name: 'c', parentId: a });
      await repo.moveFolder(child, b);
      const all = await idbGet<Folder[]>(KEYS.folders);
      const c = all!.find((f) => f.id === child)!;
      expect(c.parentId).toBe(b);
      expect(c.depth).toBe(2);
    });

    it('deleteFolder → 级联删全部后代（H8 修复）', async () => {
      const a = await repo.createFolder({ name: 'a' });
      const b = await repo.createFolder({ name: 'b', parentId: a });
      const c = await repo.createFolder({ name: 'c', parentId: b });
      await repo.deleteFolder(a);
      const all = await idbGet<Folder[]>(KEYS.folders);
      const ids = all!.map((f) => f.id);
      expect(ids).not.toContain(a);
      expect(ids).not.toContain(b);
      expect(ids).not.toContain(c);
    });

    it('deleteFolder → 笔记 folderId 归一为 null', async () => {
      const fid = await repo.createFolder({ name: 'tobedel' });
      await repo.createNote({ ciphertext: 'c', keyVersion: 1, folderId: fid });
      await repo.deleteFolder(fid);
      const all = await idbGet<NoteRow[]>(KEYS.notes);
      expect(all![0]!.folderId).toBeNull();
    });
  });

  describe('tags', () => {
    it('createTag + deleteTag', async () => {
      const id = await repo.createTag('work', '#ff0000');
      let all = await idbGet<Tag[]>(KEYS.tags);
      expect(all![0]).toMatchObject({ id, name: 'work', color: '#ff0000', count: 0 });
      await repo.deleteTag(id);
      all = await idbGet<Tag[]>(KEYS.tags);
      expect(all).toEqual([]);
    });
  });

  describe('preferences', () => {
    it('getPreferences 空库 → null', async () => {
      expect(await repo.getPreferences()).toBeNull();
    });
    it('setPreferences 第一次直接写入', async () => {
      await repo.setPreferences(rawPrefs({ theme: 'dark' }));
      const p = await repo.getPreferences();
      expect(p).toEqual({ theme: 'dark' });
    });
    it('setPreferences 后续 merge 旧值', async () => {
      await repo.setPreferences(rawPrefs({ theme: 'dark' }));
      await repo.setPreferences(rawPrefs({ lang: 'zh' }));
      const p = await repo.getPreferences();
      expect(p).toEqual({ theme: 'dark', lang: 'zh' });
    });
  });

  describe('exportBackup / importBackup / clearBusinessData', () => {
    it('exportBackup → 含 notes/folders/tags/preferences + version+source+exportedAt', async () => {
      await repo.createNote({ ciphertext: 'c', keyVersion: 1 });
      const out = await repo.exportBackup();
      expect(out.version).toBe('2.0.0');
      expect(out.source).toBe('standalone');
      expect(out.notes.length).toBe(1);
      expect(typeof out.exportedAt).toBe('string');
    });

    it('importBackup → 覆盖 notes/folders/tags/preferences', async () => {
      const payload: BackupPayload = {
        version: '2.0.0',
        exportedAt: new Date().toISOString(),
        source: 'standalone',
        notes: [
          {
            id: 'imp-1',
            ciphertext: 'x',
            keyVersion: 1,
            isPinned: false,
            isFavorite: false,
            deletedAt: null,
            version: 1,
            clientUpdatedAt: '2026-01-01T00:00:00.000Z',
            serverUpdatedAt: '2026-01-01T00:00:00.000Z',
            folderId: null,
          },
        ],
        folders: [],
        tags: [],
        preferences: null,
      };
      await repo.importBackup(payload);
      const all = await idbGet<NoteRow[]>(KEYS.notes);
      expect(all![0]!.id).toBe('imp-1');
    });

    it('clearBusinessData → 四个 key 都被清空', async () => {
      await repo.createNote({ ciphertext: 'c', keyVersion: 1 });
      await repo.createFolder({ name: 'A' });
      await repo.createTag('t');
      await repo.setPreferences(rawPrefs({ theme: 'dark' }));
      await repo.clearBusinessData();
      const [n, f, t, p] = await Promise.all([
        idbGet(KEYS.notes),
        idbGet(KEYS.folders),
        idbGet(KEYS.tags),
        idbGet(KEYS.preferences),
      ]);
      expect(n).toBeUndefined();
      expect(f).toBeUndefined();
      expect(t).toBeUndefined();
      expect(p).toBeUndefined();
    });
  });
});
