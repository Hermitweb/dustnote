/**
 * Data Slice — 笔记/文件夹/模板 CRUD、导航、UI 临时状态
 */

import type { StateCreator } from 'zustand';
import {
  type Template,
  decryptString,
  PRESET_TEMPLATES,
  fillTemplatePlaceholders,
  noteAad,
} from '@dustnote/shared';
import {
  encryptNote,
  decryptNote,
  parseEnvelope,
} from '@dustnote/client-core';
import type { StoreState } from '../store';
import type { NoteRow, NotePlaintext, Folder, ViewMode } from '../store-types';
import {
  isTransientNetworkError,
  runOrEnqueue,
  api,
  cacheNotesLocal,
  deriveLocalKey,
} from '../store-helpers';
import { randomUuid } from '../device';
import { cacheFolders, loadCachedNotes, loadCachedFolders } from '../db';
import i18n, { LANGUAGE_STORAGE_KEY } from '../i18n';
import { toast } from '../toast';

/** 初始默认文件夹与引导笔记（ensureDefaultContent 幂等创建） */
export const DEFAULT_FOLDER_NAME = '关于尘心笔记';
export const INTRO_NOTE_TITLE = '关于尘心笔记';
export const INTRO_NOTE_CONTENT = `## 欢迎使用尘心笔记

尘心笔记是一款**极简、安全**的跨端个人笔记系统。

### 核心特性

- **端到端加密**：笔记在本地加密后才同步，服务器也看不到内容
- **多端同步**：Web / Windows / 安卓 / 小程序全端覆盖
- **双向链接**：用 [[关于尘心笔记]] 语法引用其他笔记，预览模式可点击跳转
- **历史版本**：联机模式下每次保存自动留档，可随时回滚
- **离线可用**：断网也能正常记录，联网后自动同步

### 快速上手

1. 在左侧选择或新建**文件夹**，笔记必须归属某个文件夹
2. 点击「新建笔记」开始记录，支持 Markdown 语法
3. 输入 \`/\` 呼出快捷命令菜单（日期 / 列表 / 待办等）
4. 分屏模式下左侧编辑、右侧实时预览
5. ⭐ 收藏 / 📌 置顶常用笔记，🗑️ 删除的笔记可在回收站恢复

### 隐私与安全

- 主密码是唯一凭据，请务必妥善保管（无法找回）
- 建议在设置中开启两步验证与自动锁屏
- 恢复码请抄写在纸上或保存到密码管理器

*本文件夹为初始引导内容，可以随意修改或删除。*`;

export interface DataSlice {
  notes: Map<string, NoteRow>;
  notesPlain: Map<string, NotePlaintext>;
  folders: Folder[];
  templates: Template[];
  selectedNoteId: string | null;
  selectedFolderId: string | null;
  viewMode: ViewMode;
  sidebarHidden: boolean;
  searchFocusToken: number;

  loadAll: () => Promise<void>;
  /** 首次使用初始化：默认文件夹 + 引导笔记 + 未分类笔记迁移（幂等） */
  ensureDefaultContent: () => Promise<void>;
  createNote: (folderId?: string | null) => Promise<string>;
  createNoteFromTemplate: (templateId: string, folderId?: string | null) => Promise<string>;
  updateNote: (id: string, patch: Partial<NotePlaintext> & { isPinned?: boolean; isFavorite?: boolean }) => Promise<void>;
  moveNote: (id: string, folderId: string | null) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  selectNote: (id: string | null) => void;
  selectFolder: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleSidebar: () => void;
  focusSearch: () => void;
  createFolder: (name: string, opts?: { parentId?: string | null; branch?: 'work' | 'personal' | null }) => Promise<string>;
  deleteFolder: (id: string) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  moveFolder: (id: string, parentId: string | null) => Promise<void>;
  permanentDeleteNote: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  restoreNote: (id: string) => Promise<void>;
  loadTemplates: () => Promise<void>;
  saveAsTemplate: (name: string, plain: NotePlaintext) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
}

export const createDataSlice: StateCreator<StoreState, [], [], DataSlice> = (set, get) => ({
  notes: new Map(),
  notesPlain: new Map(),
  folders: [],
  templates: PRESET_TEMPLATES,
  selectedNoteId: null,
  selectedFolderId: null,
  viewMode: 'all',
  sidebarHidden: false,
  searchFocusToken: 0,

  async loadAll(): Promise<void> {
    const { mode, repository } = get();

    if (mode === 'standalone' && repository) {
      const snapshot = await repository.loadAll();
      const notesMap = new Map<string, NoteRow>(snapshot.notes.map((n: NoteRow) => [n.id, n]));
      set({ notes: notesMap, folders: snapshot.folders } as Partial<StoreState>);
      if (snapshot.preferences) {
        const merged = { ...get().preferences, ...snapshot.preferences };
        set({ preferences: merged } as Partial<StoreState>);
        if (snapshot.preferences.language) {
          localStorage.setItem(LANGUAGE_STORAGE_KEY, snapshot.preferences.language);
          void i18n.changeLanguage(snapshot.preferences.language);
        }
      }
      const masterKey = get().masterKey;
      if (masterKey) {
        const plain = new Map<string, NotePlaintext>();
        for (const n of snapshot.notes) {
          try {
            const envelope = parseEnvelope(n.ciphertext);
            const pt = await decryptNote(masterKey, envelope, noteAad(n.id, get().userId ?? ''));
            plain.set(n.id, pt);
          } catch {
            plain.set(n.id, { title: '🔒 解密失败', content: '', tags: [] });
          }
        }
        set({ notesPlain: plain } as Partial<StoreState>);
      }
      set({ templates: PRESET_TEMPLATES } as Partial<StoreState>);
      return;
    }

    try {
      const localKey = (await deriveLocalKey(get().masterKey)) ?? undefined;
      const [cachedNotes, cachedFolders] = await Promise.all([
        loadCachedNotes(localKey),
        loadCachedFolders(),
      ]);
      if (cachedNotes.notes.size > 0 || cachedFolders.length > 0) {
        set({
          notes: cachedNotes.notes,
          notesPlain: cachedNotes.plain,
          folders: cachedFolders,
        } as Partial<StoreState>);
      }
    } catch {
      /* cache read failed, continue to network */
    }

    try {
      const a = api();
      const [notesRes, foldersRes, templatesRes] = await Promise.all([
        a.get<{ notes: NoteRow[] }>('/notes?includeDeleted=1'),
        a.get<{ folders: Folder[] }>('/folders'),
        a.get<{ templates: Template[] }>('/templates'),
      ]);
      set({
        notes: new Map(notesRes.notes.map((n: NoteRow) => [n.id, n])),
        folders: foldersRes.folders,
        templates: templatesRes.templates ?? PRESET_TEMPLATES,
      } as Partial<StoreState>);

      const masterKey = get().masterKey;
      if (masterKey) {
        const plain = new Map<string, NotePlaintext>();
        for (const n of notesRes.notes) {
          try {
            const envelope = parseEnvelope(n.ciphertext);
            const pt = await decryptNote(masterKey, envelope, noteAad(n.id, get().userId ?? ''));
            plain.set(n.id, pt);
          } catch {
            plain.set(n.id, { title: '🔒 解密失败', content: '', tags: [] });
          }
        }
        set({ notesPlain: plain } as Partial<StoreState>);

        try {
          await cacheNotesLocal(get().notes, plain, () => get().masterKey);
          await cacheFolders(foldersRes.folders);
        } catch {
          /* cache write failed, not critical */
        }
      }
    } catch (err) {
      if (get().notes.size === 0) throw err;
      if (isTransientNetworkError(err)) {
        set({ isOnline: false } as Partial<StoreState>);
      }
      set({ templates: PRESET_TEMPLATES } as Partial<StoreState>);
    }
  },

  async createNote(folderId: string | null = null): Promise<string> {
    const masterKey = get().masterKey;
    if (!masterKey) throw new Error('未解锁');

    const noteId = randomUuid();
    const empty: NotePlaintext = { title: '新笔记', content: '', tags: [] };
    const { json: cipherJson } = await encryptNote(masterKey, empty, noteAad(noteId, get().userId ?? ''));

    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      const id = await repository.createNote({ id: noteId, ciphertext: cipherJson, keyVersion: 1, isPinned: false, isFavorite: false, folderId });
      const now = new Date().toISOString();
      const note: NoteRow = { id, ciphertext: cipherJson, keyVersion: 1, isPinned: false, isFavorite: false, deletedAt: null, version: 1, clientUpdatedAt: now, serverUpdatedAt: now, folderId };
      const newNotes = new Map(get().notes); newNotes.set(id, note);
      const newPlain = new Map(get().notesPlain); newPlain.set(id, empty);
      set({ notes: newNotes, notesPlain: newPlain, selectedNoteId: id } as Partial<StoreState>);
      return id;
    }

    const r = await api().post<{ id: string; serverUpdatedAt: string; version: number }>('/notes', { id: noteId, ciphertext: cipherJson, keyVersion: 1, isPinned: false, isFavorite: false, clientUpdatedAt: new Date().toISOString(), folderId });
    const note: NoteRow = { id: r.id, ciphertext: cipherJson, keyVersion: 1, isPinned: false, isFavorite: false, deletedAt: null, version: r.version, clientUpdatedAt: new Date().toISOString(), serverUpdatedAt: r.serverUpdatedAt, folderId };
    const newNotes = new Map(get().notes); newNotes.set(note.id, note);
    const newPlain = new Map(get().notesPlain); newPlain.set(note.id, empty);
    set({ notes: newNotes, notesPlain: newPlain, selectedNoteId: note.id } as Partial<StoreState>);
    return note.id;
  },

  async createNoteFromTemplate(templateId: string, folderId: string | null = null): Promise<string> {
    const masterKey = get().masterKey;
    if (!masterKey) throw new Error('未解锁');
    const tpl = get().templates.find((t) => t.id === templateId);
    if (!tpl) throw new Error('模板不存在');

    let plainContent: string;
    if (tpl.isPreset) {
      plainContent = fillTemplatePlaceholders(tpl.content);
    } else {
      const envelope = parseEnvelope(tpl.content);
      const json = await decryptString(masterKey, envelope.payload);
      const pt = JSON.parse(json) as NotePlaintext;
      plainContent = fillTemplatePlaceholders(pt.content);
    }
    const firstLine = plainContent.split('\n')[0]?.trim() || '';
    const title = firstLine.replace(/^#+\s*/, '') || tpl.name;
    const plain: NotePlaintext = { title, content: plainContent, tags: [] };
    const noteId = randomUuid();
    const { json: cipherJson } = await encryptNote(masterKey, plain, noteAad(noteId, get().userId ?? ''));

    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      const id = await repository.createNote({ id: noteId, ciphertext: cipherJson, keyVersion: 1, isPinned: false, isFavorite: false, folderId });
      const now = new Date().toISOString();
      const note: NoteRow = { id, ciphertext: cipherJson, keyVersion: 1, isPinned: false, isFavorite: false, deletedAt: null, version: 1, clientUpdatedAt: now, serverUpdatedAt: now, folderId };
      const newNotes = new Map(get().notes); newNotes.set(id, note);
      const newPlain = new Map(get().notesPlain); newPlain.set(id, plain);
      set({ notes: newNotes, notesPlain: newPlain, selectedNoteId: id } as Partial<StoreState>);
      return id;
    }

    const r = await api().post<{ id: string; serverUpdatedAt: string; version: number }>('/notes', { id: noteId, ciphertext: cipherJson, keyVersion: 1, isPinned: false, isFavorite: false, clientUpdatedAt: new Date().toISOString(), folderId });
    const note: NoteRow = { id: r.id, ciphertext: cipherJson, keyVersion: 1, isPinned: false, isFavorite: false, deletedAt: null, version: r.version, clientUpdatedAt: new Date().toISOString(), serverUpdatedAt: r.serverUpdatedAt, folderId };
    const newNotes = new Map(get().notes); newNotes.set(note.id, note);
    const newPlain = new Map(get().notesPlain); newPlain.set(note.id, plain);
    set({ notes: newNotes, notesPlain: newPlain, selectedNoteId: note.id } as Partial<StoreState>);
    return note.id;
  },

  async updateNote(id: string, patch: Partial<NotePlaintext> & { isPinned?: boolean; isFavorite?: boolean }): Promise<void> {
    const masterKey = get().masterKey;
    if (!masterKey) throw new Error('未解锁');
    const note = get().notes.get(id);
    if (!note) return;

    const current = get().notesPlain.get(id);
    const isCorrupt = !current;
    if ((patch.title !== undefined || patch.content !== undefined || patch.tags !== undefined) && isCorrupt) {
      console.warn('skip updateNote for corrupt note', id);
      return;
    }
    const merged: NotePlaintext = { title: patch.title ?? current?.title ?? '', content: patch.content ?? current?.content ?? '', tags: patch.tags ?? current?.tags ?? [] };
    const { json: cipherJson } = await encryptNote(masterKey, merged, noteAad(id, get().userId ?? ''));

    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      const version = await repository.updateNote(id, { ciphertext: cipherJson, keyVersion: 1, isPinned: patch.isPinned ?? note.isPinned, isFavorite: patch.isFavorite ?? note.isFavorite });
      const newNotes = new Map(get().notes); newNotes.set(id, { ...note, ciphertext: cipherJson, version, isPinned: patch.isPinned ?? note.isPinned, isFavorite: patch.isFavorite ?? note.isFavorite });
      const newPlain = new Map(get().notesPlain); newPlain.set(id, merged);
      set({ notes: newNotes, notesPlain: newPlain } as Partial<StoreState>);
      return;
    }

    const body = { ciphertext: cipherJson, keyVersion: 1, isPinned: patch.isPinned ?? note.isPinned, isFavorite: patch.isFavorite ?? note.isFavorite, clientUpdatedAt: new Date().toISOString(), version: note.version };
    const newNotes = new Map(get().notes); newNotes.set(id, { ...note, ciphertext: cipherJson, isPinned: patch.isPinned ?? note.isPinned, isFavorite: patch.isFavorite ?? note.isFavorite });
    const newPlain = new Map(get().notesPlain); newPlain.set(id, merged);
    set({ notes: newNotes, notesPlain: newPlain } as Partial<StoreState>);

    const ok = await runOrEnqueue(
      { method: 'PATCH', path: `/notes/${id}`, body, noteId: id },
      async () => {
        const r = await api().patch<{ version: number; serverUpdatedAt: string }>(`/notes/${id}`, body);
        const nn = new Map(get().notes); const updated = nn.get(id);
        if (updated) { nn.set(id, { ...updated, version: r.version, serverUpdatedAt: r.serverUpdatedAt }); set({ notes: nn } as Partial<StoreState>); }
      },
      () => get().refreshPendingCount()
    );
    if (!ok) set({ isOnline: false } as Partial<StoreState>);
    void cacheNotesLocal(get().notes, get().notesPlain, () => get().masterKey).catch(() => undefined);
  },

  async moveNote(id: string, folderId: string | null): Promise<void> {
    const note = get().notes.get(id);
    if (!note) return;
    if (note.folderId === folderId) return;
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      await repository.moveNote(id, folderId);
      const newNotes = new Map(get().notes); newNotes.set(id, { ...note, folderId });
      set({ notes: newNotes } as Partial<StoreState>);
      return;
    }
    const body = { folderId, clientUpdatedAt: new Date().toISOString(), version: note.version };
    const newNotes = new Map(get().notes); newNotes.set(id, { ...note, folderId });
    set({ notes: newNotes } as Partial<StoreState>);
    const ok = await runOrEnqueue({ method: 'PATCH', path: `/notes/${id}`, body, noteId: id }, async () => {
      const r = await api().patch<{ version: number; serverUpdatedAt: string }>(`/notes/${id}`, body);
      const nn = new Map(get().notes); const updated = nn.get(id);
      if (updated) { nn.set(id, { ...updated, version: r.version, serverUpdatedAt: r.serverUpdatedAt }); set({ notes: nn } as Partial<StoreState>); }
    }, () => get().refreshPendingCount());
    if (!ok) set({ isOnline: false } as Partial<StoreState>);
    void cacheNotesLocal(get().notes, get().notesPlain, () => get().masterKey).catch(() => undefined);
  },

  async deleteNote(id: string): Promise<void> {
    const note = get().notes.get(id);
    if (!note) return;
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      await repository.deleteNote(id);
      const newNotes = new Map(get().notes); newNotes.set(id, { ...note, deletedAt: new Date().toISOString() });
      set({ notes: newNotes, selectedNoteId: null } as Partial<StoreState>);
      return;
    }
    const newNotes = new Map(get().notes); newNotes.set(id, { ...note, deletedAt: new Date().toISOString() });
    set({ notes: newNotes, selectedNoteId: null } as Partial<StoreState>);
    const ok = await runOrEnqueue({ method: 'DELETE', path: `/notes/${id}`, noteId: id }, async () => { await api().delete(`/notes/${id}`); }, () => get().refreshPendingCount());
    if (!ok) set({ isOnline: false } as Partial<StoreState>);
    void cacheNotesLocal(get().notes, get().notesPlain, () => get().masterKey).catch(() => undefined);
  },

  selectNote(id: string | null): void { set({ selectedNoteId: id } as Partial<StoreState>); },
  selectFolder(id: string | null): void { set({ selectedFolderId: id, viewMode: 'all' } as Partial<StoreState>); },
  setViewMode(mode: ViewMode): void { set({ viewMode: mode, selectedFolderId: null, selectedNoteId: null } as Partial<StoreState>); },
  toggleSidebar(): void { set((s) => ({ sidebarHidden: !s.sidebarHidden } as Partial<StoreState>)); },
  focusSearch(): void { set((s) => ({ searchFocusToken: s.searchFocusToken + 1 } as Partial<StoreState>)); },

  async permanentDeleteNote(id: string): Promise<void> {
    const note = get().notes.get(id);
    if (!note) return;
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      await repository.permanentDeleteNote(id);
      const newNotes = new Map(get().notes); newNotes.delete(id);
      const newPlain = new Map(get().notesPlain); newPlain.delete(id);
      set({ notes: newNotes, notesPlain: newPlain, selectedNoteId: get().selectedNoteId === id ? null : get().selectedNoteId } as Partial<StoreState>);
      return;
    }
    const newNotes = new Map(get().notes); newNotes.delete(id);
    const newPlain = new Map(get().notesPlain); newPlain.delete(id);
    set({ notes: newNotes, notesPlain: newPlain, selectedNoteId: get().selectedNoteId === id ? null : get().selectedNoteId } as Partial<StoreState>);
    const ok = await runOrEnqueue({ method: 'DELETE', path: `/notes/${id}/permanent`, noteId: id }, async () => { await api().delete(`/notes/${id}/permanent`); }, () => get().refreshPendingCount());
    if (!ok) set({ isOnline: false } as Partial<StoreState>);
    void cacheNotesLocal(get().notes, get().notesPlain, () => get().masterKey).catch(() => undefined);
  },

  async emptyTrash(): Promise<void> {
    const trashIds = Array.from(get().notes.values()).filter((n) => n.deletedAt).map((n) => n.id);
    if (trashIds.length === 0) return;
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      await repository.emptyTrash();
      const newNotes = new Map(get().notes); const newPlain = new Map(get().notesPlain);
      for (const id of trashIds) { newNotes.delete(id); newPlain.delete(id); }
      set({ notes: newNotes, notesPlain: newPlain, selectedNoteId: null } as Partial<StoreState>);
      return;
    }
    const newNotes = new Map(get().notes); const newPlain = new Map(get().notesPlain);
    for (const id of trashIds) { newNotes.delete(id); newPlain.delete(id); }
    set({ notes: newNotes, notesPlain: newPlain, selectedNoteId: null } as Partial<StoreState>);
    let anyEnqueued = false;
    for (const id of trashIds) {
      try { await api().delete(`/notes/${id}/permanent`); } catch (err) {
        const e = err as { err?: { status?: number } };
        if (e.err?.status === 409 || e.err?.status === 404) continue;
        if (isTransientNetworkError(err)) { await (await import('../offline-queue')).enqueue({ method: 'DELETE', path: `/notes/${id}/permanent`, noteId: id }); anyEnqueued = true; }
      }
    }
    if (anyEnqueued) { set({ isOnline: false } as Partial<StoreState>); await get().refreshPendingCount(); }
    void cacheNotesLocal(get().notes, get().notesPlain, () => get().masterKey).catch(() => undefined);
  },

  async restoreNote(id: string): Promise<void> {
    const note = get().notes.get(id);
    if (!note || !note.deletedAt) return;
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      await repository.restoreNote(id);
      const newNotes = new Map(get().notes); newNotes.set(id, { ...note, deletedAt: null });
      set({ notes: newNotes } as Partial<StoreState>);
      return;
    }
    const body = { deletedAt: null, clientUpdatedAt: new Date().toISOString(), version: note.version };
    const newNotes = new Map(get().notes); newNotes.set(id, { ...note, deletedAt: null });
    set({ notes: newNotes } as Partial<StoreState>);
    const ok = await runOrEnqueue({ method: 'PATCH', path: `/notes/${id}`, body, noteId: id }, async () => {
      const r = await api().patch<{ version: number }>(`/notes/${id}`, body);
      const nn = new Map(get().notes); const updated = nn.get(id);
      if (updated) { nn.set(id, { ...updated, version: r.version }); set({ notes: nn } as Partial<StoreState>); }
    }, () => get().refreshPendingCount());
    if (!ok) set({ isOnline: false } as Partial<StoreState>);
    void cacheNotesLocal(get().notes, get().notesPlain, () => get().masterKey).catch(() => undefined);
  },

  async loadTemplates(): Promise<void> {
    const { mode } = get();
    if (mode === 'standalone') { set({ templates: PRESET_TEMPLATES } as Partial<StoreState>); return; }
    try {
      // 服务端只存用户自定义模板（预设在前端内置），两者合并展示——
      // 旧实现整体覆盖导致联机模式预设模板消失
      const r = await api().get<{ templates: Template[] }>('/templates');
      set({ templates: [...PRESET_TEMPLATES, ...(r.templates ?? [])] } as Partial<StoreState>);
    } catch { set({ templates: PRESET_TEMPLATES } as Partial<StoreState>); }
  },

  async saveAsTemplate(name: string, plain: NotePlaintext): Promise<void> {
    const masterKey = get().masterKey;
    if (!masterKey) throw new Error('未解锁');
    const { mode } = get();
    if (mode !== 'online') throw new Error('自定义模板仅在联机模式可用');
    const { json: cipherJson } = await encryptNote(masterKey, plain);
    const r = await api().post<{ id: string }>('/templates', { name, description: '', category: 'custom', icon: '📝', content: cipherJson, sortOrder: 100 });
    const newTemplate: Template = { id: r.id, userId: get().userId, name, description: '', category: 'custom', icon: '📝', content: cipherJson, isPreset: false, sortOrder: 100, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    set({ templates: [...get().templates, newTemplate] } as Partial<StoreState>);
  },

  async deleteTemplate(id: string): Promise<void> {
    const { mode } = get();
    if (mode !== 'online') throw new Error('自定义模板仅在联机模式可用');
    const tpl = get().templates.find((t) => t.id === id);
    if (!tpl) return;
    if (tpl.isPreset) throw new Error('预设模板不可删除');
    await api().delete(`/templates/${id}`);
    set({ templates: get().templates.filter((t) => t.id !== id) } as Partial<StoreState>);
  },

  async createFolder(name: string, opts?: { parentId?: string | null; branch?: 'work' | 'personal' | null }): Promise<string> {
    const parentId = opts?.parentId ?? null;
    const parent = parentId ? get().folders.find((f) => f.id === parentId) : undefined;
    const depth = parent ? (parent.depth ?? 1) + 1 : 1;
    const branch = parentId ? (parent?.branch ?? null) : (opts?.branch ?? null);
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      const id = await repository.createFolder({ name, parentId, branch });
      set({ folders: [...get().folders, { id, name, parentId, icon: null, sortOrder: get().folders.length, createdAt: new Date().toISOString(), depth, branch }] } as Partial<StoreState>);
      return id;
    }
    const body: { name: string; parentId: string | null; branch?: 'work' | 'personal' } = { name, parentId };
    if (branch) body.branch = branch;
    const r = await api().post<{ id: string }>('/folders', body);
    set({ folders: [...get().folders, { id: r.id, name, parentId, icon: null, sortOrder: 0, createdAt: new Date().toISOString(), depth, branch }] } as Partial<StoreState>);
    return r.id;
  },

  /**
   * 首次使用初始化（幂等，解锁并 loadAll 后调用一次）：
   * 1. 无任何文件夹时创建默认文件夹「关于尘心笔记」+ 引导笔记
   * 2. 历史未分类笔记（folderId=null 且未删除）迁入默认文件夹
   *    ——「未分类」分组已从产品移除，笔记必须归属文件夹
   */
  async ensureDefaultContent(): Promise<void> {
    const { folders, notes, masterKey } = get();
    if (!masterKey) return;
    if (folders.length > 0) return;

    const folderId = await get().createFolder(DEFAULT_FOLDER_NAME);
    // 迁移历史未分类笔记（先迁移再建引导笔记，避免引导笔记被重复处理）
    let migrated = 0;
    for (const n of notes.values()) {
      if (!n.deletedAt && !n.folderId) {
        try {
          await get().moveNote(n.id, folderId);
          migrated++;
        } catch {
          /* 单条失败不阻塞初始化 */
        }
      }
    }
    // 引导笔记（E2EE 加密后创建，与普通笔记无异，可编辑可删除）
    const noteId = await get().createNote(folderId);
    await get().updateNote(noteId, { title: INTRO_NOTE_TITLE, content: INTRO_NOTE_CONTENT });
    if (migrated > 0) {
      toast.info(i18n.t('sidebar.unfiled_migrated', { count: migrated }) || `已把 ${migrated} 条未分类笔记移入「${DEFAULT_FOLDER_NAME}」`);
    }
  },

  async deleteFolder(id: string): Promise<void> {
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      await repository.deleteFolder(id);
      set({ folders: get().folders.filter((f) => f.id !== id) } as Partial<StoreState>);
      const newNotes = new Map(get().notes); let changed = false;
      for (const [nid, n] of newNotes) { if (n.folderId === id) { newNotes.set(nid, { ...n, folderId: null }); changed = true; } }
      if (changed) set({ notes: newNotes } as Partial<StoreState>);
      return;
    }
    set({ folders: get().folders.filter((f) => f.id !== id) } as Partial<StoreState>);
    const ok = await runOrEnqueue({ method: 'DELETE', path: `/folders/${id}` }, async () => { await api().delete(`/folders/${id}`); }, () => get().refreshPendingCount());
    if (!ok) set({ isOnline: false } as Partial<StoreState>);
    void cacheFolders(get().folders).catch(() => undefined);
  },

  async renameFolder(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('文件夹名不能为空');
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) { await repository.renameFolder(id, trimmed); set({ folders: get().folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f)) } as Partial<StoreState>); return; }
    set({ folders: get().folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f)) } as Partial<StoreState>);
    const ok = await runOrEnqueue({ method: 'PATCH', path: `/folders/${id}` }, async () => { await api().patch(`/folders/${id}`, { name: trimmed }); }, () => get().refreshPendingCount());
    if (!ok) set({ isOnline: false } as Partial<StoreState>);
    void cacheFolders(get().folders).catch(() => undefined);
  },

  async moveFolder(id: string, parentId: string | null): Promise<void> {
    const { mode, repository } = get();
    const parent = parentId ? get().folders.find((f) => f.id === parentId) : undefined;
    const depth = parent ? (parent.depth ?? 1) + 1 : 1;
    const branch = parent ? (parent.branch ?? null) : null;
    if (mode === 'standalone' && repository) { await repository.moveFolder(id, parentId); set({ folders: get().folders.map((f) => (f.id === id ? { ...f, parentId, depth, branch } : f)) } as Partial<StoreState>); return; }
    set({ folders: get().folders.map((f) => (f.id === id ? { ...f, parentId, depth, branch } : f)) } as Partial<StoreState>);
    const ok = await runOrEnqueue({ method: 'PATCH', path: `/folders/${id}` }, async () => { await api().patch(`/folders/${id}`, { parentId }); }, () => get().refreshPendingCount());
    if (!ok) set({ isOnline: false } as Partial<StoreState>);
    void cacheFolders(get().folders).catch(() => undefined);
  },
});
