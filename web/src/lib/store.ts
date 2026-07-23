/**
 * 全局状态：masterKey、auth、notes、folders、tags、theme、i18n、preferences
 *
 * masterKey 仅存内存（refresh 后清空），刷新页面需重新解锁
 */

import { create } from 'zustand';
import {
  ApiClient,
  type Ciphertext,
  deriveMasterKey,
  decryptString,
  encryptString,
  generateRecoveryCode,
  wrapMasterKey,
  deriveRecoveryKey,
  fromBase64,
  toBase64,
  randomBytes,
} from '@dustnote/shared';
import { getDeviceId } from './device';
import { applyTheme } from './theme';
import i18n from './i18n';

const API_BASE = '/api/v1';
const APP_VERSION = __APP_VERSION__;

const api = (): ApiClient =>
  new ApiClient({
    baseUrl: API_BASE,
    clientVersion: APP_VERSION,
    platform: 'web',
    channel: 'stable',
    deviceId: getDeviceId(),
    accessToken: useStore.getState().accessToken ?? undefined,
  });

// ========== 类型 ==========

/** 笔记密文信封：服务端只存这整个对象（JSON 序列化后存 DB） */
export interface NoteCipherEnvelope {
  /** 信封版本 */
  v: number;
  /** 加密后的明文 blob（包含 title/content/tags） */
  payload: Ciphertext;
  /** 客户端明文（仅在内存中持有，从 payload 解密得到） */
}

export interface NoteRow {
  id: string;
  ciphertext: string; // 服务端存的密文 JSON 字符串
  keyVersion: number;
  isPinned: boolean;
  isFavorite: boolean;
  deletedAt: string | null;
  version: number;
  clientUpdatedAt: string;
  serverUpdatedAt: string;
  folderId: string | null;
}

export interface NotePlaintext {
  title: string;
  content: string;
  tags: string[];
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

export type AuthState = 'unknown' | 'uninitialized' | 'needs_unlock' | 'unlocked';

/** 侧栏视图：全部 / 收藏 / 回收站 */
export type ViewMode = 'all' | 'favorites' | 'trash';

export type ThemeId =
  | 'mint-dawn'
  | 'mist-blue'
  | 'dusk-forest'
  | 'caramel-warm'
  | 'sakura-pink'
  | 'minimal-white';
export type Mode = 'light' | 'dark' | 'auto';

export interface Preferences {
  theme: ThemeId;
  mode: Mode;
  font: 'system' | 'manrope' | 'lxgw';
  density: 'comfortable' | 'standard' | 'compact';
  autoLock: number;
  language: 'zh-CN' | 'en';
}

// ========== Store ==========

interface StoreState {
  // auth
  authState: AuthState;
  accessToken: string | null;
  userId: string | null;
  serverSalt: string | null; // base64
  masterKey: Uint8Array | null;
  wrappedMasterKey: Ciphertext | null;

  // data
  notes: Map<string, NoteRow>;
  notesPlain: Map<string, NotePlaintext>;
  folders: Folder[];
  tags: Tag[];
  selectedNoteId: string | null;
  selectedFolderId: string | null;
  /** 当前侧栏视图（全部/收藏/回收站） */
  viewMode: ViewMode;

  // preferences
  preferences: Preferences;

  // actions: auth
  checkStatus: () => Promise<void>;
  setup: (password: string) => Promise<string>; // 返回 recoveryCode
  unlock: (password: string) => Promise<void>;
  recover: (recoveryCode: string, newPassword: string) => Promise<void>;
  lock: () => void;

  // actions: data
  loadAll: () => Promise<void>;
  createNote: (folderId?: string | null) => Promise<string>;
  updateNote: (
    id: string,
    patch: Partial<NotePlaintext> & { isPinned?: boolean; isFavorite?: boolean }
  ) => Promise<void>;
  /** 移动笔记到指定文件夹（null = 移出文件夹） */
  moveNote: (id: string, folderId: string | null) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  selectNote: (id: string | null) => void;
  selectFolder: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  createFolder: (name: string) => Promise<string>;
  deleteFolder: (id: string) => Promise<void>;
  /** 永久删除笔记（不可恢复） */
  permanentDeleteNote: (id: string) => Promise<void>;
  /** 清空回收站：永久删除所有已软删的笔记 */
  emptyTrash: () => Promise<void>;
  /** 恢复笔记：从回收站还原 */
  restoreNote: (id: string) => Promise<void>;

  // actions: prefs
  setPreferences: (p: Partial<Preferences>) => void;
  setTheme: (theme: ThemeId) => void;
  setMode: (mode: Mode) => void;
  setLanguage: (lang: 'zh-CN' | 'en') => void;
}

const DEFAULT_PREFS: Preferences = {
  theme: 'mint-dawn',
  mode: 'auto',
  font: 'system',
  density: 'standard',
  autoLock: 15,
  language: 'zh-CN',
};

const PREFS_KEY = 'dustnote_preferences';

function loadPrefs(): Preferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS;
}

function savePrefs(p: Preferences): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

// ========== 加密信封辅助 ==========

const ENVELOPE_VERSION = 1;

async function encryptNote(
  key: Uint8Array,
  pt: NotePlaintext
): Promise<{ envelope: NoteCipherEnvelope; json: string }> {
  const json = JSON.stringify(pt);
  const blob = await encryptString(key, json, 1);
  const envelope: NoteCipherEnvelope = { v: ENVELOPE_VERSION, payload: blob };
  return { envelope, json: JSON.stringify(envelope) };
}

async function decryptNote(key: Uint8Array, envelope: NoteCipherEnvelope): Promise<NotePlaintext> {
  if (envelope.v !== ENVELOPE_VERSION) throw new Error(`envelope version mismatch: ${envelope.v}`);
  const json = await decryptString(key, envelope.payload);
  return JSON.parse(json) as NotePlaintext;
}

function parseEnvelope(raw: string): NoteCipherEnvelope {
  // 服务端可能把 ciphertext 存为 JSON 字符串（包含 envelope），也可能存为对象字符串
  // 兼容两种格式
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed === 'object' && parsed !== null && 'v' in parsed && 'payload' in parsed) {
    return parsed as NoteCipherEnvelope;
  }
  // 旧格式：直接是 Ciphertext
  if (typeof parsed === 'object' && parsed !== null && 'c' in parsed && 'n' in parsed) {
    return { v: ENVELOPE_VERSION, payload: parsed as Ciphertext };
  }
  throw new Error('invalid envelope');
}

// ========== Store 实现 ==========

export const useStore = create<StoreState>((set, get) => ({
  authState: 'unknown',
  accessToken: null,
  userId: null,
  serverSalt: null,
  masterKey: null,
  wrappedMasterKey: null,
  notes: new Map(),
  notesPlain: new Map(),
  folders: [],
  tags: [],
  selectedNoteId: null,
  selectedFolderId: null,
  viewMode: 'all',
  preferences: loadPrefs(),

  // -------- auth --------

  async checkStatus(): Promise<void> {
    const r = await api().get<{ initialized: boolean; deviceKnown: boolean }>('/auth/status');
    if (!r.initialized) {
      set({ authState: 'uninitialized' });
    } else {
      set({ authState: 'needs_unlock' });
    }
  },

  async setup(password: string): Promise<string> {
    const recoveryCode = generateRecoveryCode();
    const clientMasterSalt = randomBytes(16);
    const masterKey = await deriveMasterKey(password, clientMasterSalt);
    const recoverySalt = randomBytes(16);
    const recoveryKey = deriveRecoveryKey(recoveryCode, recoverySalt);
    const wrapped = await wrapMasterKey(recoveryKey, masterKey);

    const r = await api().post<{
      accessToken: string;
      userId: string;
      deviceId: string;
      clientMasterSalt: string;
    }>('/auth/setup', {
      password,
      recoveryCode,
      wrappedMasterKey: wrapped,
      clientMasterSalt: toBase64(clientMasterSalt),
      deviceName: 'Web 浏览器',
    });

    set({
      accessToken: r.accessToken,
      userId: r.userId,
      serverSalt: r.clientMasterSalt,
      masterKey,
      wrappedMasterKey: wrapped,
      authState: 'unlocked',
    });
    return recoveryCode;
  },

  async unlock(password: string): Promise<void> {
    const r = await api().post<{
      accessToken: string;
      userId: string;
      deviceId: string;
      clientMasterSalt: string;
    }>('/auth/unlock', { password, deviceName: 'Web 浏览器' });
    const clientMasterSalt = fromBase64(r.clientMasterSalt);
    const masterKey = await deriveMasterKey(password, clientMasterSalt);

    set({
      accessToken: r.accessToken,
      userId: r.userId,
      serverSalt: r.clientMasterSalt,
      masterKey,
      authState: 'unlocked',
    });
  },

  async recover(recoveryCode: string, newPassword: string): Promise<void> {
    const newClientMasterSalt = randomBytes(16);
    const newMasterKey = await deriveMasterKey(newPassword, newClientMasterSalt);
    const recoverySalt = randomBytes(16);
    const newRecoveryKey = deriveRecoveryKey(recoveryCode, recoverySalt);
    const newWrapped = await wrapMasterKey(newRecoveryKey, newMasterKey);

    const r = await api().post<{
      accessToken: string;
      userId: string;
      deviceId: string;
      clientMasterSalt: string;
    }>('/auth/recover', {
      recoveryCode,
      newPassword,
      newWrappedMasterKey: newWrapped,
      newClientMasterSalt: toBase64(newClientMasterSalt),
      deviceName: 'Web 浏览器（恢复）',
    });

    set({
      accessToken: r.accessToken,
      userId: r.userId,
      serverSalt: r.clientMasterSalt,
      masterKey: newMasterKey,
      wrappedMasterKey: newWrapped,
      authState: 'unlocked',
    });
  },

  lock(): void {
    const k = get().masterKey;
    if (k) k.fill(0);
    set({ masterKey: null, selectedNoteId: null });
  },

  // -------- data --------

  async loadAll(): Promise<void> {
    const a = api();
    const [notesRes, foldersRes, tagsRes, meRes] = await Promise.all([
      // includeDeleted=1：回收站视图需要拿到已软删的笔记
      a.get<{ notes: NoteRow[] }>('/notes?includeDeleted=1'),
      a.get<{ folders: Folder[] }>('/folders'),
      a.get<{ tags: Tag[] }>('/tags'),
      a.get<{ wrappedMasterKey: Ciphertext }>('/auth/me'),
    ]);
    set({
      notes: new Map(notesRes.notes.map((n: NoteRow) => [n.id, n])),
      folders: foldersRes.folders,
      tags: tagsRes.tags,
      wrappedMasterKey: meRes.wrappedMasterKey,
    });

    const masterKey = get().masterKey;
    if (masterKey) {
      const plain = new Map<string, NotePlaintext>();
      for (const n of notesRes.notes) {
        try {
          const envelope = parseEnvelope(n.ciphertext);
          const pt = await decryptNote(masterKey, envelope);
          plain.set(n.id, pt);
        } catch {
          plain.set(n.id, { title: '🔒 解密失败', content: '', tags: [] });
        }
      }
      set({ notesPlain: plain });
    }
  },

  async createNote(folderId: string | null = null): Promise<string> {
    const masterKey = get().masterKey;
    if (!masterKey) throw new Error('未解锁');

    const empty: NotePlaintext = { title: '新笔记', content: '', tags: [] };
    const { json: cipherJson } = await encryptNote(masterKey, empty);

    const r = await api().post<{ id: string; serverUpdatedAt: string; version: number }>('/notes', {
      ciphertext: cipherJson,
      keyVersion: 1,
      isPinned: false,
      isFavorite: false,
      clientUpdatedAt: new Date().toISOString(),
      folderId,
    });

    const note: NoteRow = {
      id: r.id,
      ciphertext: cipherJson,
      keyVersion: 1,
      isPinned: false,
      isFavorite: false,
      deletedAt: null,
      version: r.version,
      clientUpdatedAt: new Date().toISOString(),
      serverUpdatedAt: r.serverUpdatedAt,
      folderId,
    };

    const newNotes = new Map(get().notes);
    newNotes.set(note.id, note);
    const newPlain = new Map(get().notesPlain);
    newPlain.set(note.id, empty);
    set({ notes: newNotes, notesPlain: newPlain, selectedNoteId: note.id });
    return note.id;
  },

  async updateNote(
    id: string,
    patch: Partial<NotePlaintext> & { isPinned?: boolean; isFavorite?: boolean }
  ): Promise<void> {
    const masterKey = get().masterKey;
    if (!masterKey) throw new Error('未解锁');
    const note = get().notes.get(id);
    if (!note) return;

    // 解密失败的笔记禁止自动保存；只接受显式的 pin/favorite 元数据更新
    const current = get().notesPlain.get(id);
    const isCorrupt = !current;
    if (
      (patch.title !== undefined || patch.content !== undefined || patch.tags !== undefined) &&
      isCorrupt
    ) {
      console.warn('skip updateNote for corrupt note', id);
      return;
    }
    const merged: NotePlaintext = {
      title: patch.title ?? current?.title ?? '',
      content: patch.content ?? current?.content ?? '',
      tags: patch.tags ?? current?.tags ?? [],
    };
    const { json: cipherJson } = await encryptNote(masterKey, merged);

    const r = await api().patch<{ version: number; serverUpdatedAt: string }>(`/notes/${id}`, {
      ciphertext: cipherJson,
      keyVersion: 1,
      isPinned: patch.isPinned ?? note.isPinned,
      isFavorite: patch.isFavorite ?? note.isFavorite,
      clientUpdatedAt: new Date().toISOString(),
      version: note.version,
    });

    const newNotes = new Map(get().notes);
    newNotes.set(id, {
      ...note,
      version: r.version,
      serverUpdatedAt: r.serverUpdatedAt,
      ciphertext: cipherJson,
    });
    const newPlain = new Map(get().notesPlain);
    newPlain.set(id, merged);
    set({ notes: newNotes, notesPlain: newPlain });
  },

  async moveNote(id: string, folderId: string | null): Promise<void> {
    const note = get().notes.get(id);
    if (!note) return;
    if (note.folderId === folderId) return; // 已在目标文件夹，无需请求
    const r = await api().patch<{ version: number; serverUpdatedAt: string }>(`/notes/${id}`, {
      folderId,
      clientUpdatedAt: new Date().toISOString(),
      version: note.version,
    });
    const newNotes = new Map(get().notes);
    newNotes.set(id, { ...note, folderId, version: r.version, serverUpdatedAt: r.serverUpdatedAt });
    set({ notes: newNotes });
  },

  async deleteNote(id: string): Promise<void> {
    const note = get().notes.get(id);
    if (!note) return;
    await api().delete(`/notes/${id}`);
    const newNotes = new Map(get().notes);
    newNotes.set(id, { ...note, deletedAt: new Date().toISOString() });
    set({ notes: newNotes, selectedNoteId: null });
  },

  selectNote(id: string | null): void {
    set({ selectedNoteId: id });
  },
  selectFolder(id: string | null): void {
    set({ selectedFolderId: id, viewMode: 'all' });
  },
  setViewMode(mode: ViewMode): void {
    set({ viewMode: mode, selectedFolderId: null, selectedNoteId: null });
  },
  async permanentDeleteNote(id: string): Promise<void> {
    const note = get().notes.get(id);
    if (!note) return;
    await api().delete(`/notes/${id}/permanent`);
    const newNotes = new Map(get().notes);
    newNotes.delete(id);
    const newPlain = new Map(get().notesPlain);
    newPlain.delete(id);
    set({
      notes: newNotes,
      notesPlain: newPlain,
      selectedNoteId: get().selectedNoteId === id ? null : get().selectedNoteId,
    });
  },
  async emptyTrash(): Promise<void> {
    const trashIds = Array.from(get().notes.values())
      .filter((n) => n.deletedAt)
      .map((n) => n.id);
    if (trashIds.length === 0) return;
    // 并发删除（服务端允许永久删除已软删笔记）
    await Promise.all(trashIds.map((id) => api().delete(`/notes/${id}/permanent`)));
    const newNotes = new Map(get().notes);
    const newPlain = new Map(get().notesPlain);
    for (const id of trashIds) {
      newNotes.delete(id);
      newPlain.delete(id);
    }
    set({ notes: newNotes, notesPlain: newPlain, selectedNoteId: null });
  },
  async restoreNote(id: string): Promise<void> {
    const note = get().notes.get(id);
    if (!note || !note.deletedAt) return;
    const r = await api().patch<{ version: number }>(`/notes/${id}`, {
      deletedAt: null,
      clientUpdatedAt: new Date().toISOString(),
      version: note.version,
    });
    const newNotes = new Map(get().notes);
    newNotes.set(id, { ...note, deletedAt: null, version: r.version });
    set({ notes: newNotes });
  },

  async createFolder(name: string): Promise<string> {
    const r = await api().post<{ id: string }>('/folders', { name });
    set({
      folders: [
        ...get().folders,
        {
          id: r.id,
          name,
          parentId: null,
          icon: null,
          sortOrder: 0,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    return r.id;
  },

  async deleteFolder(id: string): Promise<void> {
    await api().delete(`/folders/${id}`);
    set({ folders: get().folders.filter((f) => f.id !== id) });
  },

  // -------- prefs --------

  setPreferences(p: Partial<Preferences>): void {
    const next = { ...get().preferences, ...p };
    savePrefs(next);
    set({ preferences: next });
    if (p.theme) applyTheme(p.theme, next.mode);
    if (p.mode) applyTheme(next.theme, p.mode);
    if (p.language) void i18n.changeLanguage(p.language);
    void api()
      .patch('/preferences', p)
      .catch(() => undefined);
  },

  setTheme(theme: ThemeId): void {
    get().setPreferences({ theme });
  },
  setMode(mode: Mode): void {
    get().setPreferences({ mode });
  },
  setLanguage(language: 'zh-CN' | 'en'): void {
    get().setPreferences({ language });
  },
}));
