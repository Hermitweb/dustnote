/**
 * web/src/lib/slices/offline-slice.ts - handleNoteConflict direct tests (Round 22)
 *
 * 直接 import 已 export 的 handleNoteConflict 函数（不依赖 flushQueue 路径），
 * 完整 mock '../store' 让 useStore.getState() 命中测试的 storeState。
 *
 * 覆盖：
 *   - conflictCtx 缺失 → no-op
 *   - masterKey 缺失 → no-op
 *   - 服务端 data.current 缺失 → no-op
 *   - parseEnvelope / decryptNote 抛错 → no-op
 *   - 无冲突 (hasConflicts=false) → 写本地 + api.patch 重写
 *   - 有冲突 (hasConflicts=true) → 写本地 + pendingConflicts 推入
 *   - re-PATCH 抛错 → 静默
 *   - noteId 不在 notes 里 → 不写 notes 行但写 plaintext
 *   - masterKey 缺失 → no-op（重复路径）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installPolyfills } from '../../test/polyfills';

installPolyfills();

// 共享 storeState（handleNoteConflict 内部 await import('../store') 获取 useStore）
const storeState = vi.hoisted(() => ({
  // masterKey 允许为 null（覆盖「已锁屏 → no-op」分支）
  masterKey: new Uint8Array(32).fill(0x11) as Uint8Array | null,
  userId: 'u-1',
  notes: new Map<string, NoteRow>(),
  notesPlain: new Map<string, { title: string; content: string; tags: string[] }>(),
  pendingConflicts: [] as unknown[],
}));

vi.mock('../store', () => ({
  useStore: {
    getState: () => storeState,
    setState: (partial: unknown) => {
      if (typeof partial === 'function') {
        // function form 必须用其返回值 apply 到 storeState
        const update = (partial as (s: typeof storeState) => Partial<typeof storeState>)(
          storeState
        );
        Object.assign(storeState, update);
      } else {
        Object.assign(storeState, partial);
      }
    },
  },
}));

// store-helpers 提供 api()
const apiPatch = vi.fn();
const apiGet = vi.fn();
vi.mock('../store-helpers', () => ({
  isTransientNetworkError: vi.fn(),
  runOrEnqueue: vi.fn(),
  api: () => ({
    get: (...a: unknown[]) => apiGet(...a),
    post: vi.fn(),
    patch: (...a: unknown[]) => apiPatch(...a),
    delete: vi.fn(),
  }),
  cacheNotesLocal: vi.fn(async () => undefined),
  cacheFolders: vi.fn(async () => undefined),
  deriveLocalKey: vi.fn(),
  replayOp: vi.fn(),
  flushingRef: { inFlight: false },
  shareBase: vi.fn(() => '/api/v1'),
  authedFetch: vi.fn(),
}));

vi.mock('../db', () => ({
  clearCache: vi.fn(),
  loadCachedNotes: vi.fn(),
  loadCachedFolders: vi.fn(),
  cacheFolders: vi.fn(),
  cacheNotesLocal: vi.fn(),
}));

vi.mock('../device', () => ({ getDeviceId: () => 'dev-1' }));
vi.mock('../toast', () => ({ toast: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../i18n', () => ({ default: { t: (k: string) => k, changeLanguage: vi.fn() } }));

const mockResolveConflictResult = {
  hasConflicts: false,
  merged: {
    id: 'n1',
    plaintext: { title: 'merged', content: 'merged', tags: [] },
    isPinned: false,
    isFavorite: false,
    folderId: null,
    deletedAt: null,
    clientUpdatedAt: '2025-01-01T00:00:00Z',
  },
  conflicts: [],
};

vi.mock('@dustnote/shared', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dustnote/shared');
  return {
    ...actual,
    ApiException: class ApiException extends Error {
      err: { status?: number; data?: unknown };
      constructor(e: { status: number; data?: unknown; message?: string }) {
        super(e.message ?? 'ApiException');
        this.err = { status: e.status, data: e.data };
      }
    },
  };
});

vi.mock('@dustnote/client-core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dustnote/client-core');
  return {
    ...actual,
    encryptNote: vi.fn(async () => ({ json: { v: 1, k: 'k', n: 'n', c: 'MERGED-CIPHER' } })),
    decryptNote: vi.fn(async () => ({
      title: 'server-plain',
      content: 'server-content',
      tags: [],
    })),
    parseEnvelope: vi.fn(() => true),
    resolveConflict: vi.fn(() => mockResolveConflictResult),
    toMergeable: vi.fn((id: string, plaintext: unknown, meta: unknown) => ({
      id,
      ...(plaintext as object),
      ...(meta as object),
    })),
  };
});

import { handleNoteConflict } from './offline-slice.js';
import { ApiException } from '@dustnote/shared';
import type { NoteRow } from '../store-types';
import type { QueuedOp } from '../offline-queue';

function noteRow(id: string, overrides: Partial<NoteRow> = {}): NoteRow {
  return {
    id,
    ciphertext: '{}',
    keyVersion: 1,
    isPinned: false,
    isFavorite: false,
    deletedAt: null,
    version: 1,
    clientUpdatedAt: '2025-01-01T00:00:00.000Z',
    serverUpdatedAt: '2025-01-01T00:00:00.000Z',
    folderId: null,
    ...overrides,
  };
}

function buildConflictCtx(noteId = 'n1'): NonNullable<QueuedOp['conflictCtx']> {
  return {
    noteId,
    baseVersion: 1,
    base: {
      id: noteId,
      plaintext: { title: 'base', content: 'b', tags: [] },
      isPinned: false,
      isFavorite: false,
      deletedAt: null,
      folderId: null,
      clientUpdatedAt: '2025-01-01T00:00:00Z',
    },
    local: {
      id: noteId,
      plaintext: { title: 'local', content: 'l', tags: [] },
      isPinned: false,
      isFavorite: false,
      deletedAt: null,
      folderId: 'b1',
      clientUpdatedAt: '2025-01-02T00:00:00Z',
    },
  };
}

function buildErr(serverRow: NoteRow) {
  return new ApiException({
    status: 409,
    code: 'version_mismatch',
    message: 'stale',
    data: { current: serverRow },
  } as never);
}

/**
 * buildOp 的覆盖参数：conflictCtx 允许显式传 undefined
 * （exactOptionalPropertyTypes 下 optional 属性不能显式赋 undefined），
 * 用来覆盖「conflictCtx 缺失 → no-op」分支。
 */
type OpOverrides = Partial<Omit<QueuedOp, 'conflictCtx'>> & {
  conflictCtx?: QueuedOp['conflictCtx'] | undefined;
};

function buildOp(overrides: OpOverrides = {}): QueuedOp {
  return {
    id: 'op-1',
    method: 'PATCH',
    path: '/notes/n1',
    createdAt: '2025-01-01T00:00:00.000Z',
    retries: 0,
    conflictCtx: buildConflictCtx('n1'),
    ...overrides,
  } as unknown as QueuedOp;
}

beforeEach(() => {
  apiPatch.mockReset();
  apiGet.mockReset();
  storeState.notes = new Map();
  storeState.notesPlain = new Map();
  storeState.pendingConflicts = [];
  storeState.masterKey = new Uint8Array(32).fill(0x11);
  storeState.userId = 'u-1';
});

describe('offline-slice.handleNoteConflict (直接调用)', () => {
  it('conflictCtx 缺失 → no-op（不调 api.patch）', async () => {
    const op = buildOp({ conflictCtx: undefined });
    await handleNoteConflict(op, buildErr(noteRow('n1')));
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it('masterKey 缺失 → no-op', async () => {
    storeState.masterKey = null;
    await handleNoteConflict(buildOp(), buildErr(noteRow('n1')));
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it('服务端 409 data.current 缺失 → no-op', async () => {
    const err = new ApiException({
      status: 409,
      code: 'version_mismatch',
      message: 'stale',
      data: {},
    } as never);
    await handleNoteConflict(buildOp(), err);
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it('parseEnvelope 抛错 → no-op', async () => {
    const { parseEnvelope } = await import('@dustnote/client-core');
    (parseEnvelope as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('bad envelope');
    });
    await handleNoteConflict(buildOp(), buildErr(noteRow('n1', { ciphertext: 'BAD' })));
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it('decryptNote 抛错 → no-op', async () => {
    const { decryptNote } = await import('@dustnote/client-core');
    (decryptNote as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('decrypt fail')
    );
    await handleNoteConflict(buildOp(), buildErr(noteRow('n1', { ciphertext: 'env' })));
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it('无冲突 → 写本地 notes+plain + 调 api.patch 用 server.version 重写', async () => {
    storeState.notes.set('n1', { ...noteRow('n1', { version: 1 }) });
    storeState.notesPlain.set('n1', { title: 'local', content: 'l', tags: [] });

    apiPatch.mockResolvedValueOnce({ version: 8, serverUpdatedAt: 'x' });
    const serverRow = noteRow('n1', { version: 7 });
    await handleNoteConflict(buildOp(), buildErr(serverRow));

    // 本地明文写入 merged.title='merged'
    expect(storeState.notesPlain.get('n1')?.title).toBe('merged');
    // notes 行被重写（version 来自 server=7，因 re-PATCH 成功会再更新到 8）
    const updated = storeState.notes.get('n1') as NoteRow;
    expect(updated.version).toBe(8); // re-PATCH 后的版本
    // api.patch 调了一次
    expect(apiPatch).toHaveBeenCalledTimes(1);
    expect(apiPatch).toHaveBeenCalledWith('/notes/n1', expect.objectContaining({ version: 7 }));
    // pendingConflicts 没新增
    expect(storeState.pendingConflicts.length).toBe(0);
  });

  it('有冲突 → 写本地 notes+plain + 推 pendingConflicts（不调 api.patch）', async () => {
    const { resolveConflict } = await import('@dustnote/client-core');
    (resolveConflict as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      hasConflicts: true,
      conflicts: [{ field: 'title' }],
      merged: {
        id: 'n1',
        plaintext: { title: 'merged', content: 'hi', tags: [] },
        isPinned: false,
        isFavorite: false,
        folderId: 'fx',
        deletedAt: null,
        clientUpdatedAt: '2025-01-01T00:00:00Z',
      },
    });

    storeState.notes.set('n1', { ...noteRow('n1', { version: 1 }) });
    storeState.notesPlain.set('n1', { title: 'local', content: 'l', tags: [] });
    const serverRow = noteRow('n1', { version: 9 });

    await handleNoteConflict(buildOp(), buildErr(serverRow));

    // 本地 notes 写入（folderId 用 merged 的 'fx'）
    expect((storeState.notes.get('n1') as NoteRow).folderId).toBe('fx');
    // pendingConflicts 推入了一条
    expect(storeState.pendingConflicts.length).toBe(1);
    // api.patch 不调（避免再次冲撞）
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it('re-PATCH 抛错 → 静默（不阻塞，loadAll 兜底）', async () => {
    storeState.notes.set('n1', { ...noteRow('n1', { version: 1 }) });
    storeState.notesPlain.set('n1', { title: 'local', content: 'l', tags: [] });
    apiPatch.mockRejectedValueOnce(new Error('repatch-fail'));
    const serverRow = noteRow('n1', { version: 7 });

    await expect(handleNoteConflict(buildOp(), buildErr(serverRow))).resolves.toBeUndefined();
    // 本地明文已写（write happens before re-PATCH）
    expect(storeState.notesPlain.get('n1')?.title).toBe('merged');
  });

  it('noteId 不在 notes 里 → 不写 notes + 不写 plaintext（existing 不存在 → 整段跳过）', async () => {
    // notes 空（不预设 n1）
    storeState.notesPlain.set('n1', { title: 'local', content: 'l', tags: [] });
    apiPatch.mockResolvedValueOnce({ version: 8, serverUpdatedAt: 'x' });
    const serverRow = noteRow('n1', { version: 7 });

    await handleNoteConflict(buildOp(), buildErr(serverRow));

    expect(storeState.notes.has('n1')).toBe(false);
    // source 实际行为：existing 不在 → 整段写 notes+notesPlain 跳过，plaintext 也不写
    expect(storeState.notesPlain.get('n1')?.title).toBe('local');
  });

  it('已存在的 pendingConflict 同 noteId → 被替换（filter + push）', async () => {
    storeState.pendingConflicts = [{ noteId: 'n1', conflicts: ['old'], merged: 'old-merged' }];
    const { resolveConflict } = await import('@dustnote/client-core');
    (resolveConflict as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      hasConflicts: true,
      conflicts: [{ field: 'title' }],
      merged: {
        id: 'n1',
        plaintext: { title: 'new', content: 'c', tags: [] },
        isPinned: false,
        isFavorite: false,
        folderId: null,
        deletedAt: null,
        clientUpdatedAt: 'x',
      },
    });

    const serverRow = noteRow('n1', { version: 5 });
    await handleNoteConflict(buildOp(), buildErr(serverRow));

    expect(storeState.pendingConflicts.length).toBe(1);
    const pc = storeState.pendingConflicts[0] as {
      noteId: string;
      merged: { plaintext: { title: string } };
    };
    expect(pc.noteId).toBe('n1');
    expect(pc.merged.plaintext.title).toBe('new');
  });
});
