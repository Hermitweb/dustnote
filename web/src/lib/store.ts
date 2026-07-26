/**
 * 全局状态：masterKey、auth、notes、folders、tags、theme、i18n、preferences
 *
 * v2.0.0 支持 单机/联机 双模式：
 * - standalone：数据存储在 IndexedDB（LocalRepository），鉴权走 local-auth.ts
 * - online：数据存储在服务端（RemoteRepository），鉴权走 /auth/* API
 *
 * masterKey 仅存内存（refresh 后清空），刷新页面需重新解锁
 */

import { create } from 'zustand';
import {
  ApiClient,
  ApiException,
  type Ciphertext,
  type DataRepository,
  type AppMode,
  deriveMasterKey,
  decryptString,
  encryptString,
  generateRecoveryCode,
  wrapMasterKey,
  deriveRecoveryKey,
  fromBase64,
  toBase64,
  randomBytes,
  setupLocalAuth,
  unlockLocalAuth,
  recoverLocalAuth,
  recordFailedAttempt,
  recordSuccessfulAttempt,
  isLocked,
  remainingLockoutMs,
  INITIAL_LOCKOUT_STATE,
  LOCAL_LOCKOUT_DURATION_MS,
  type LocalAuthBlob,
  type LocalLockoutState,
} from '@dustnote/shared';
import { getDeviceId } from './device';
import { applyTheme } from './theme';
import i18n from './i18n';
import {
  cacheNotes,
  cacheFolders,
  cacheTags,
  loadCachedNotes,
  loadCachedFolders,
  loadCachedTags,
  clearCache,
} from './db';
import { enqueue, peekAll, remove, bumpRetries, size as queueSize } from './offline-queue';
import type { QueuedOp } from './offline-queue';
import { useModeStore } from './mode-store';
import { createRepository } from './repository';
import {
  loadLocalAuthBlob,
  saveLocalAuthBlob,
  clearLocalAuthBlob,
  loadLockoutState,
  saveLockoutState,
  clearLockoutState,
} from './local-auth-storage';

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
  // mode（v2.0.0）
  /** 当前应用模式 */
  mode: AppMode;
  /** 数据访问 Repository（根据 mode 注入） */
  repository: DataRepository | null;

  // auth
  authState: AuthState;
  accessToken: string | null;
  userId: string | null;
  serverSalt: string | null; // base64
  masterKey: Uint8Array | null;
  wrappedMasterKey: Ciphertext | null;
  /** 单机模式本地鉴权 blob */
  localAuthBlob: LocalAuthBlob | null;
  /** 单机模式锁定状态 */
  lockoutState: LocalLockoutState;

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

  // offline-first
  isOnline: boolean;
  /** 待同步的离线操作数量（来自 offline-queue） */
  pendingCount: number;

  // actions: mode
  /** 初始化 Repository（根据当前模式注入） */
  initRepository: () => void;
  /** 切换模式（含数据迁移） */
  switchMode: (target: AppMode, serverUrl?: string | null) => Promise<void>;

  // actions: auth（联机模式）
  checkStatus: () => Promise<void>;
  setup: (password: string) => Promise<string>; // 返回 recoveryCode
  unlock: (password: string) => Promise<void>;
  recover: (recoveryCode: string, newPassword: string) => Promise<void>;
  lock: () => void;

  // actions: auth（单机模式）
  /** 单机模式：检查本地鉴权状态 */
  checkStatusStandalone: () => void;
  /** 单机模式：首次设置主密码 */
  setupStandalone: (password: string) => Promise<string>;
  /** 单机模式：解锁 */
  unlockStandalone: (password: string) => Promise<void>;
  /** 单机模式：恢复码重置密码 */
  recoverStandalone: (recoveryCode: string, newPassword: string) => Promise<void>;
  /** 单机模式：获取剩余锁定时间（ms） */
  getRemainingLockoutMs: () => number;

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

  // actions: offline
  /** 由 online-listener 调用，更新在线状态 */
  setOnline: (online: boolean) => void;
  /** 刷新 pendingCount（供 UI 订阅） */
  refreshPendingCount: () => Promise<void>;
  /** 重放离线队列；409/4xx 丢弃，网络错误保留 */
  flushQueue: () => Promise<void>;
  /** 注销时清空本地缓存 + 队列 */
  clearLocalData: () => Promise<void>;
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

// ========== 离线辅助 ==========

/**
 * 判断错误是否为网络故障（应入队重试）。
 *
 * - fetch 抛 TypeError：DNS 解析失败 / 离线 / CORS 阻断 → 入队
 * - ApiException 5xx：服务端错误，可能恢复 → 入队
 * - ApiException 4xx：客户端错误（如 409 冲突），不可恢复 → 不入队
 */
function isTransientNetworkError(err: unknown): boolean {
  if (err instanceof ApiException) {
    return err.err.status >= 500;
  }
  // TypeError: Failed to fetch
  return err instanceof TypeError;
}

/**
 * 执行一个 mutation；网络失败时入队等待重放。
 *
 * @param op 入队用的操作描述（method/path/body/noteId）
 * @param fn 实际执行网络的函数
 * @returns 成功返回 true，已入队返回 false
 */
async function runOrEnqueue(
  op: { method: 'POST' | 'PATCH' | 'DELETE'; path: string; body?: unknown; noteId?: string },
  fn: () => Promise<unknown>
): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    if (isTransientNetworkError(err)) {
      await enqueue(op);
      await useStore.getState().refreshPendingCount();
      return false;
    }
    throw err;
  }
}

// ========== Store 实现 ==========

export const useStore = create<StoreState>((set, get) => ({
  // mode（v2.0.0）
  mode: useModeStore.getState().mode,
  repository: null,

  // auth
  authState: 'unknown',
  accessToken: null,
  userId: null,
  serverSalt: null,
  masterKey: null,
  wrappedMasterKey: null,
  localAuthBlob: null,
  lockoutState: INITIAL_LOCKOUT_STATE,

  // data
  notes: new Map(),
  notesPlain: new Map(),
  folders: [],
  tags: [],
  selectedNoteId: null,
  selectedFolderId: null,
  viewMode: 'all',

  // preferences
  preferences: loadPrefs(),

  // offline-first
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pendingCount: 0,

  // -------- mode actions --------

  initRepository(): void {
    const { mode } = get();
    const repo = createRepository(
      { mode, serverUrl: useModeStore.getState().serverUrl },
      () => get().accessToken
    );
    set({ repository: repo });
  },

  async switchMode(target: AppMode, serverUrl: string | null = null): Promise<void> {
    const { repository, masterKey } = get();
    if (!repository || !masterKey) {
      throw new Error('切换模式前需先解锁');
    }
    // 1. 导出当前模式的数据
    const backup = await repository.exportBackup();
    // 2. 更新 mode-store
    useModeStore.getState().setMode(target);
    if (serverUrl !== null) {
      useModeStore.getState().setServerUrl(serverUrl);
    }
    // 3. 初始化新 Repository
    const newRepo = createRepository(
      { mode: target, serverUrl: useModeStore.getState().serverUrl },
      () => get().accessToken
    );
    // 4. 清空新模式的业务数据（避免重复）
    await newRepo.clearBusinessData();
    // 5. 导入备份数据
    await newRepo.importBackup(backup);
    // 6. 更新 store
    set({ mode: target, repository: newRepo });
    // 7. 重新加载数据
    await get().loadAll();
  },

  // -------- standalone auth --------

  checkStatusStandalone(): void {
    const blob = loadLocalAuthBlob();
    const lockout = loadLockoutState();
    if (!blob) {
      set({ authState: 'uninitialized', lockoutState: lockout });
    } else if (isLocked(lockout)) {
      set({ authState: 'needs_unlock', localAuthBlob: blob, lockoutState: lockout });
    } else {
      set({ authState: 'needs_unlock', localAuthBlob: blob, lockoutState: lockout });
    }
  },

  async setupStandalone(password: string): Promise<string> {
    const result = await setupLocalAuth(password);
    saveLocalAuthBlob(result.blob);
    clearLockoutState();
    set({
      localAuthBlob: result.blob,
      masterKey: result.masterKey,
      lockoutState: INITIAL_LOCKOUT_STATE,
      authState: 'unlocked',
    });
    return result.recoveryCode;
  },

  async unlockStandalone(password: string): Promise<void> {
    const { localAuthBlob, lockoutState } = get();
    if (!localAuthBlob) throw new Error('未初始化');
    if (isLocked(lockoutState)) {
      const remaining = remainingLockoutMs(lockoutState);
      throw new Error(`账号已锁定，请 ${Math.ceil(remaining / 1000)} 秒后重试`);
    }
    const result = await unlockLocalAuth(password, localAuthBlob);
    if (!result.success) {
      const newState = recordFailedAttempt(lockoutState);
      saveLockoutState(newState);
      set({ lockoutState: newState });
      if (isLocked(newState)) {
        throw new Error(`密码错误次数过多，账号已锁定 ${LOCAL_LOCKOUT_DURATION_MS / 60000} 分钟`);
      }
      throw new Error('主密码错误');
    }
    const successState = recordSuccessfulAttempt();
    saveLockoutState(successState);
    set({
      masterKey: result.masterKey,
      lockoutState: successState,
      authState: 'unlocked',
    });
  },

  async recoverStandalone(recoveryCode: string, newPassword: string): Promise<void> {
    const { localAuthBlob } = get();
    if (!localAuthBlob) throw new Error('未初始化');
    const result = await recoverLocalAuth(recoveryCode, newPassword, localAuthBlob);
    if (!result.success || !result.blob || !result.masterKey || !result.recoveryCode) {
      throw new Error('恢复码错误');
    }
    saveLocalAuthBlob(result.blob);
    clearLockoutState();
    set({
      localAuthBlob: result.blob,
      masterKey: result.masterKey,
      lockoutState: INITIAL_LOCKOUT_STATE,
      authState: 'unlocked',
    });
  },

  getRemainingLockoutMs(): number {
    return remainingLockoutMs(get().lockoutState);
  },

  // -------- auth --------

  async checkStatus(): Promise<void> {
    const { mode } = get();
    if (mode === 'standalone') {
      // 单机模式：检查本地鉴权 blob
      get().checkStatusStandalone();
      return;
    }
    // 联机模式：调用 /auth/status API
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
    set({ masterKey: null, selectedNoteId: null, notesPlain: new Map() });
  },

  // -------- data --------

  async loadAll(): Promise<void> {
    const { mode, repository } = get();

    // 单机模式：直接从 LocalRepository 加载
    if (mode === 'standalone' && repository) {
      const snapshot = await repository.loadAll();
      const notesMap = new Map<string, NoteRow>(snapshot.notes.map((n: NoteRow) => [n.id, n]));
      set({
        notes: notesMap,
        folders: snapshot.folders,
        tags: snapshot.tags,
      });
      if (snapshot.preferences) {
        set({ preferences: { ...get().preferences, ...snapshot.preferences } });
      }
      // 解密笔记
      const masterKey = get().masterKey;
      if (masterKey) {
        const plain = new Map<string, NotePlaintext>();
        for (const n of snapshot.notes) {
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
      return;
    }

    // 联机模式：Offline-first，先用 IndexedDB 缓存填充 store，UI 立即可见；
    // 同时发起网络请求拉取最新数据。失败时保留缓存（不抛错）。
    try {
      const [cachedNotes, cachedFolders, cachedTags] = await Promise.all([
        loadCachedNotes(),
        loadCachedFolders(),
        loadCachedTags(),
      ]);
      if (cachedNotes.notes.size > 0 || cachedFolders.length > 0) {
        set({
          notes: cachedNotes.notes,
          notesPlain: cachedNotes.plain,
          folders: cachedFolders,
          tags: cachedTags,
        });
      }
    } catch {
      /* 缓存读取失败，忽略，继续走网络 */
    }

    try {
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

        // 网络成功后刷新缓存（明文 + 密文）
        try {
          await cacheNotes(get().notes, plain);
          await cacheFolders(foldersRes.folders);
          await cacheTags(tagsRes.tags);
        } catch {
          /* 缓存写入失败不影响主流程 */
        }
      }
    } catch (err) {
      // 网络失败：如果已有缓存则静默保留；否则抛错让上层处理
      if (get().notes.size === 0) throw err;
      // 标记离线状态
      if (isTransientNetworkError(err)) {
        set({ isOnline: false });
      }
    }
  },

  async createNote(folderId: string | null = null): Promise<string> {
    const masterKey = get().masterKey;
    if (!masterKey) throw new Error('未解锁');

    const empty: NotePlaintext = { title: '新笔记', content: '', tags: [] };
    const { json: cipherJson } = await encryptNote(masterKey, empty);

    // 单机模式：直接写入 LocalRepository
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      const id = await repository.createNote({
        ciphertext: cipherJson,
        keyVersion: 1,
        isPinned: false,
        isFavorite: false,
        folderId,
      });
      const now = new Date().toISOString();
      const note: NoteRow = {
        id,
        ciphertext: cipherJson,
        keyVersion: 1,
        isPinned: false,
        isFavorite: false,
        deletedAt: null,
        version: 1,
        clientUpdatedAt: now,
        serverUpdatedAt: now,
        folderId,
      };
      const newNotes = new Map(get().notes);
      newNotes.set(id, note);
      const newPlain = new Map(get().notesPlain);
      newPlain.set(id, empty);
      set({ notes: newNotes, notesPlain: newPlain, selectedNoteId: id });
      return id;
    }

    // 联机模式：API + 离线队列
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

    // 单机模式：直接更新 LocalRepository
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      const version = await repository.updateNote(id, {
        ciphertext: cipherJson,
        keyVersion: 1,
        isPinned: patch.isPinned ?? note.isPinned,
        isFavorite: patch.isFavorite ?? note.isFavorite,
      });
      const newNotes = new Map(get().notes);
      newNotes.set(id, { ...note, ciphertext: cipherJson, version });
      const newPlain = new Map(get().notesPlain);
      newPlain.set(id, merged);
      set({ notes: newNotes, notesPlain: newPlain });
      return;
    }

    // 联机模式：乐观更新 + API + 离线队列
    const body = {
      ciphertext: cipherJson,
      keyVersion: 1,
      isPinned: patch.isPinned ?? note.isPinned,
      isFavorite: patch.isFavorite ?? note.isFavorite,
      clientUpdatedAt: new Date().toISOString(),
      version: note.version,
    };

    // 乐观更新：先写入本地 store，UI 立即反映
    const newNotes = new Map(get().notes);
    newNotes.set(id, { ...note, ciphertext: cipherJson });
    const newPlain = new Map(get().notesPlain);
    newPlain.set(id, merged);
    set({ notes: newNotes, notesPlain: newPlain });

    // 网络请求：失败时入队，不回滚（用户已看到变更）
    const ok = await runOrEnqueue(
      { method: 'PATCH', path: `/notes/${id}`, body, noteId: id },
      async () => {
        const r = await api().patch<{ version: number; serverUpdatedAt: string }>(
          `/notes/${id}`,
          body
        );
        // 成功后用服务端返回的 version/serverUpdatedAt 校正本地
        const nn = new Map(get().notes);
        const updated = nn.get(id);
        if (updated) {
          nn.set(id, { ...updated, version: r.version, serverUpdatedAt: r.serverUpdatedAt });
          set({ notes: nn });
        }
      }
    );
    if (!ok) {
      // 已入队，更新离线徽章计数
      set({ isOnline: false });
    }
    // 缓存刷新（异步，不阻塞）
    void cacheNotes(get().notes, get().notesPlain).catch(() => undefined);
  },

  async moveNote(id: string, folderId: string | null): Promise<void> {
    const note = get().notes.get(id);
    if (!note) return;
    if (note.folderId === folderId) return; // 已在目标文件夹，无需请求

    // 单机模式：直接更新 LocalRepository
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      await repository.moveNote(id, folderId);
      const newNotes = new Map(get().notes);
      newNotes.set(id, { ...note, folderId });
      set({ notes: newNotes });
      return;
    }

    // 联机模式：乐观更新 + API + 离线队列
    const body = {
      folderId,
      clientUpdatedAt: new Date().toISOString(),
      version: note.version,
    };

    // 乐观更新
    const newNotes = new Map(get().notes);
    newNotes.set(id, { ...note, folderId });
    set({ notes: newNotes });

    const ok = await runOrEnqueue(
      { method: 'PATCH', path: `/notes/${id}`, body, noteId: id },
      async () => {
        const r = await api().patch<{ version: number; serverUpdatedAt: string }>(
          `/notes/${id}`,
          body
        );
        const nn = new Map(get().notes);
        const updated = nn.get(id);
        if (updated) {
          nn.set(id, { ...updated, version: r.version, serverUpdatedAt: r.serverUpdatedAt });
          set({ notes: nn });
        }
      }
    );
    if (!ok) set({ isOnline: false });
    void cacheNotes(get().notes, get().notesPlain).catch(() => undefined);
  },

  async deleteNote(id: string): Promise<void> {
    const note = get().notes.get(id);
    if (!note) return;

    // 单机模式：直接更新 LocalRepository
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      await repository.deleteNote(id);
      const newNotes = new Map(get().notes);
      newNotes.set(id, { ...note, deletedAt: new Date().toISOString() });
      set({ notes: newNotes, selectedNoteId: null });
      return;
    }

    // 联机模式：乐观更新 + API + 离线队列
    const newNotes = new Map(get().notes);
    newNotes.set(id, { ...note, deletedAt: new Date().toISOString() });
    set({ notes: newNotes, selectedNoteId: null });

    const ok = await runOrEnqueue(
      { method: 'DELETE', path: `/notes/${id}`, noteId: id },
      async () => {
        await api().delete(`/notes/${id}`);
      }
    );
    if (!ok) set({ isOnline: false });
    void cacheNotes(get().notes, get().notesPlain).catch(() => undefined);
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

    // 单机模式：直接删除
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      await repository.permanentDeleteNote(id);
      const newNotes = new Map(get().notes);
      newNotes.delete(id);
      const newPlain = new Map(get().notesPlain);
      newPlain.delete(id);
      set({
        notes: newNotes,
        notesPlain: newPlain,
        selectedNoteId: get().selectedNoteId === id ? null : get().selectedNoteId,
      });
      return;
    }

    // 联机模式：乐观更新 + API + 离线队列
    const newNotes = new Map(get().notes);
    newNotes.delete(id);
    const newPlain = new Map(get().notesPlain);
    newPlain.delete(id);
    set({
      notes: newNotes,
      notesPlain: newPlain,
      selectedNoteId: get().selectedNoteId === id ? null : get().selectedNoteId,
    });

    const ok = await runOrEnqueue(
      { method: 'DELETE', path: `/notes/${id}/permanent`, noteId: id },
      async () => {
        await api().delete(`/notes/${id}/permanent`);
      }
    );
    if (!ok) set({ isOnline: false });
    void cacheNotes(get().notes, get().notesPlain).catch(() => undefined);
  },
  async emptyTrash(): Promise<void> {
    const trashIds = Array.from(get().notes.values())
      .filter((n) => n.deletedAt)
      .map((n) => n.id);
    if (trashIds.length === 0) return;

    // 单机模式：直接清空
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      await repository.emptyTrash();
      const newNotes = new Map(get().notes);
      const newPlain = new Map(get().notesPlain);
      for (const id of trashIds) {
        newNotes.delete(id);
        newPlain.delete(id);
      }
      set({ notes: newNotes, notesPlain: newPlain, selectedNoteId: null });
      return;
    }

    // 联机模式：乐观更新 + API + 离线队列
    const newNotes = new Map(get().notes);
    const newPlain = new Map(get().notesPlain);
    for (const id of trashIds) {
      newNotes.delete(id);
      newPlain.delete(id);
    }
    set({ notes: newNotes, notesPlain: newPlain, selectedNoteId: null });

    // 并发删除；失败的单条入队
    const results = await Promise.allSettled(
      trashIds.map((id) => api().delete(`/notes/${id}/permanent`))
    );
    let anyEnqueued = false;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const failedId = trashIds[i];
      if (r!.status === 'rejected' && failedId !== undefined) {
        if (isTransientNetworkError(r!.reason)) {
          await enqueue({
            method: 'DELETE',
            path: `/notes/${failedId}/permanent`,
            noteId: failedId,
          });
          anyEnqueued = true;
        }
      }
    }
    if (anyEnqueued) {
      set({ isOnline: false });
      await get().refreshPendingCount();
    }
    void cacheNotes(get().notes, get().notesPlain).catch(() => undefined);
  },
  async restoreNote(id: string): Promise<void> {
    const note = get().notes.get(id);
    if (!note || !note.deletedAt) return;

    // 单机模式：直接恢复
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      await repository.restoreNote(id);
      const newNotes = new Map(get().notes);
      newNotes.set(id, { ...note, deletedAt: null });
      set({ notes: newNotes });
      return;
    }

    // 联机模式：乐观更新 + API + 离线队列
    const body = {
      deletedAt: null,
      clientUpdatedAt: new Date().toISOString(),
      version: note.version,
    };
    // 乐观更新
    const newNotes = new Map(get().notes);
    newNotes.set(id, { ...note, deletedAt: null });
    set({ notes: newNotes });

    const ok = await runOrEnqueue(
      { method: 'PATCH', path: `/notes/${id}`, body, noteId: id },
      async () => {
        const r = await api().patch<{ version: number }>(`/notes/${id}`, body);
        const nn = new Map(get().notes);
        const updated = nn.get(id);
        if (updated) {
          nn.set(id, { ...updated, version: r.version });
          set({ notes: nn });
        }
      }
    );
    if (!ok) set({ isOnline: false });
    void cacheNotes(get().notes, get().notesPlain).catch(() => undefined);
  },

  async createFolder(name: string): Promise<string> {
    // 单机模式：直接创建
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      const id = await repository.createFolder({ name });
      set({
        folders: [
          ...get().folders,
          {
            id,
            name,
            parentId: null,
            icon: null,
            sortOrder: get().folders.length,
            createdAt: new Date().toISOString(),
          },
        ],
      });
      return id;
    }

    // 联机模式：API
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
    // 单机模式：直接删除
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      await repository.deleteFolder(id);
      set({ folders: get().folders.filter((f) => f.id !== id) });
      // 该文件夹下的笔记 folderId 置为 null
      const newNotes = new Map(get().notes);
      let changed = false;
      for (const [nid, n] of newNotes) {
        if (n.folderId === id) {
          newNotes.set(nid, { ...n, folderId: null });
          changed = true;
        }
      }
      if (changed) set({ notes: newNotes });
      return;
    }

    // 联机模式：乐观更新 + API + 离线队列
    set({ folders: get().folders.filter((f) => f.id !== id) });
    const ok = await runOrEnqueue({ method: 'DELETE', path: `/folders/${id}` }, async () => {
      await api().delete(`/folders/${id}`);
    });
    if (!ok) set({ isOnline: false });
    void cacheFolders(get().folders).catch(() => undefined);
  },

  // -------- prefs --------

  setPreferences(p: Partial<Preferences>): void {
    const next = { ...get().preferences, ...p };
    savePrefs(next);
    set({ preferences: next });
    if (p.theme) applyTheme(p.theme, next.mode);
    if (p.mode) applyTheme(next.theme, p.mode);
    if (p.language) void i18n.changeLanguage(p.language);

    // 单机模式：写入 LocalRepository
    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      void repository.setPreferences(p).catch(() => undefined);
    } else {
      // 联机模式：同步到服务端
      void api()
        .patch('/preferences', p)
        .catch(() => undefined);
    }
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

  // -------- offline --------

  setOnline(online: boolean): void {
    set({ isOnline: online });
    if (online) {
      // 联网时自动刷新一次 pendingCount（队列可能为空）
      void get().refreshPendingCount();
    }
  },

  async refreshPendingCount(): Promise<void> {
    try {
      const n = await queueSize();
      set({ pendingCount: n });
    } catch {
      /* ignore */
    }
  },

  async flushQueue(): Promise<void> {
    const ops = await peekAll();
    if (ops.length === 0) return;

    let hadConflict = false;
    for (const op of ops) {
      try {
        await replayOp(op);
        await remove(op.id);
      } catch (err) {
        if (err instanceof ApiException) {
          const status = err.err.status;
          if (status === 409 || (status >= 400 && status < 500)) {
            // 冲突或客户端错误：丢弃该 op，避免死循环
            await remove(op.id);
            hadConflict = true;
          } else {
            // 5xx：服务端可能恢复，保留并增加重试计数
            await bumpRetries(op.id);
          }
        } else if (err instanceof TypeError) {
          // 网络仍不可达：停止重放，保留 op
          break;
        } else {
          // 未知错误：丢弃避免阻塞队列
          await remove(op.id);
        }
      }
    }

    await get().refreshPendingCount();

    // 冲突或全部成功后，拉取最新数据校正本地
    if (hadConflict || ops.length > 0) {
      try {
        await get().loadAll();
      } catch {
        /* loadAll 内部已处理 */
      }
    }

    // 重放后若全部成功，标记为在线
    if ((await queueSize()) === 0) {
      set({ isOnline: true });
    }
  },

  async clearLocalData(): Promise<void> {
    await clearCache();
    const { clear: clearQueue } = await import('./offline-queue');
    await clearQueue();
    // 单机模式：清除本地鉴权数据 + 锁定状态
    clearLocalAuthBlob();
    clearLockoutState();
    set({ pendingCount: 0, localAuthBlob: null, lockoutState: INITIAL_LOCKOUT_STATE });
  },
}));

/** 重放单个 op：用当前 store 的 accessToken 构造请求 */
async function replayOp(op: QueuedOp): Promise<void> {
  const client = api();
  await client.request<unknown>(op.method, op.path, op.body);
}
