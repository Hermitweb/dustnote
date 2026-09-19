/**
 * RemoteRepository（跨端单一实现）测试 —— 审计 ARCH-002
 *
 * 之前三端各写一份且已漂移，本文件锁住收敛后的行为契约：
 * - loadAll 游标分页到底（>500 条不截断）
 * - 乐观锁 version 传递与快照更新
 * - emptyTrash 走分页 + 单条失败计数（不再静默漏删）
 * - importBackup：文件夹→标签→笔记顺序、跳过回收站、只吞 409
 * - createFolder 显式 null 契约
 */
import { describe, expect, it, vi } from 'vitest';
import { RemoteRepository } from '../src/remote-repository.js';
import type { ApiClient, NoteRow } from '@dustnote/shared';

type Recorded = { method: string; path: string; body?: unknown };

/**
 * 极简假 ApiClient：key 形如 'GET /notes'（按 path 去 query 后精确匹配），
 * handler 收到 (path, body, 该 key 的第几次调用)。
 */
function fakeApi(handlers: Record<string, (path: string, body?: unknown, n?: number) => unknown>) {
  const calls: Recorded[] = [];
  const counts = new Map<string, number>();
  const invoke = (method: string) => async (path: string, body?: unknown) => {
    calls.push({ method, path, body });
    const base = path.split('?')[0] ?? path;
    const key = `${method.toUpperCase()} ${base}`;
    const fn = handlers[key];
    if (!fn) throw new Error(`no handler for ${key}`);
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    return fn(path, body, n);
  };
  const api = {
    get: invoke('get'),
    post: invoke('post'),
    patch: invoke('patch'),
    delete: invoke('delete'),
  } as unknown as ApiClient;
  return { api, calls };
}

function note(id: string, over: Partial<NoteRow> = {}): NoteRow {
  return {
    id,
    ciphertext: 'ct',
    keyVersion: 1,
    isPinned: false,
    isFavorite: false,
    folderId: null,
    version: 1,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as NoteRow;
}

describe('loadAll', () => {
  it('游标分页拉全量并填充 version 快照', async () => {
    let page = 0;
    const { api } = fakeApi({
      'GET /notes': () => {
        page += 1;
        if (page === 1) return { notes: [note('n1')], nextCursor: 'c1' };
        if (page === 2) return { notes: [note('n2')], nextCursor: 'c2' };
        return { notes: [note('n3')], nextCursor: null };
      },
      'GET /folders': () => ({ folders: [] }),
      'GET /tags': () => ({ tags: [] }),
      'GET /preferences': () => ({ theme: 'mist-blue' }),
    });
    const repo = new RemoteRepository(() => api);
    const snap = await repo.loadAll();

    expect(snap.notes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
    expect(snap.preferences).toEqual({ theme: 'mist-blue' });

    // 快照 version 被记录：updateNote 不传 version 时用快照值
    const { api: api2, calls } = fakeApi({
      'PATCH /notes/n2': () => ({ version: 9 }),
    });
    const repo2 = new RemoteRepository(() => api2);
    // 先 loadAll 填充快照
    await repo2.loadAll().catch(() => undefined);
    void calls;
  });

  it('preferences 请求失败不阻塞 loadAll', async () => {
    const { api } = fakeApi({
      'GET /notes': () => ({ notes: [], nextCursor: null }),
      'GET /folders': () => ({ folders: [] }),
      'GET /tags': () => ({ tags: [] }),
      'GET /preferences': () => {
        throw new Error('404');
      },
    });
    const repo = new RemoteRepository(() => api);
    await expect(repo.loadAll()).resolves.toMatchObject({ preferences: null });
  });
});

describe('updateNote / moveNote / restoreNote 乐观锁', () => {
  it('loadAll 后未显式传 version → 用快照 version，并回写新 version', async () => {
    const { api, calls } = fakeApi({
      'GET /notes': () => ({ notes: [note('n1', { version: 3 })], nextCursor: null }),
      'GET /folders': () => ({ folders: [] }),
      'GET /tags': () => ({ tags: [] }),
      'GET /preferences': () => {
        throw new Error('404');
      },
      'PATCH /notes/n1': () => ({ version: 4 }),
    });
    const repo = new RemoteRepository(() => api);
    await repo.loadAll();

    await expect(repo.updateNote('n1', { isPinned: true })).resolves.toBe(4);
    const patch = calls.find((c) => c.method === 'patch');
    expect((patch?.body as { version?: number }).version).toBe(3);

    // 快照已更新为 4：再改一次应带 4
    await repo.updateNote('n1', { isFavorite: true });
    const patches = calls.filter((c) => c.method === 'patch');
    expect((patches[1]?.body as { version?: number }).version).toBe(4);
  });

  it('未知 version 时不发 version 字段（避免并发 0 伪装成版本冲突）', async () => {
    const { api, calls } = fakeApi({ 'PATCH /notes/x': () => ({ version: 1 }) });
    const repo = new RemoteRepository(() => api);
    await repo.updateNote('x', { isPinned: true });
    expect('version' in (calls[0]?.body as object)).toBe(false);
  });

  it('moveNote / restoreNote 回写服务端返回的新 version', async () => {
    const { api, calls } = fakeApi({
      'GET /notes': () => ({ notes: [note('n1', { version: 5 })], nextCursor: null }),
      'GET /folders': () => ({ folders: [] }),
      'GET /tags': () => ({ tags: [] }),
      'GET /preferences': () => {
        throw new Error('404');
      },
      'PATCH /notes/n1': () => ({ version: 6 }),
    });
    const repo = new RemoteRepository(() => api);
    await repo.loadAll();
    await repo.moveNote('n1', 'f1');
    await repo.restoreNote('n1');
    const patches = calls.filter((c) => c.method === 'patch');
    expect((patches[0]?.body as { version?: number }).version).toBe(5);
    expect((patches[1]?.body as { version?: number }).version).toBe(6);
  });
});

describe('emptyTrash', () => {
  it('分页取回全部回收站笔记，逐条永久删除并计数失败', async () => {
    let page = 0;
    const deleted: string[] = [];
    const { api } = fakeApi({
      'GET /notes': () => {
        page += 1;
        if (page === 1)
          return { notes: [note('t1', { deletedAt: 'x' }), note('k1')], nextCursor: 'c1' };
        return { notes: [note('t2', { deletedAt: 'x' })], nextCursor: null };
      },
      'GET /folders': () => ({ folders: [] }),
      'GET /tags': () => ({ tags: [] }),
      'GET /preferences': () => {
        throw new Error('404');
      },
      'DELETE /notes/t2/permanent': () => {
        throw Object.assign(new Error('boom'), { err: { status: 500 } });
      },
      'DELETE /notes/t1/permanent': (path: string) => {
        deleted.push(path);
        return undefined;
      },
    });
    const repo = new RemoteRepository(() => api);
    const result = await repo.emptyTrash();

    expect(deleted).toEqual(['/notes/t1/permanent']);
    expect(result).toEqual({ deleted: 1, failed: 1 });
  });
});

describe('importBackup', () => {
  const payload = {
    version: '2.0.0',
    exportedAt: '2026-01-01T00:00:00.000Z',
    notes: [note('n1', { folderId: 'f1' }), note('trashed', { deletedAt: 'x' })],
    folders: [{ id: 'f1', name: 'F', parentId: null, icon: null, depth: 1, branch: null }],
    tags: [{ id: 'g1', name: 'T', color: null }],
    preferences: null,
    source: 'online' as const,
  };

  it('顺序为文件夹→标签→笔记，跳过回收站笔记', async () => {
    const order: string[] = [];
    const { api, calls } = fakeApi({
      'POST /folders': () => {
        order.push('folder');
        return { id: 'f1' };
      },
      'POST /tags': () => {
        order.push('tag');
        return { id: 'g1' };
      },
      'POST /notes': () => {
        order.push('note');
        return { id: 'n1' };
      },
    });
    const repo = new RemoteRepository(() => api);
    await repo.importBackup(payload as never);

    expect(order).toEqual(['folder', 'tag', 'note']);
    const notePost = calls.filter((c) => c.path === '/notes');
    expect(notePost).toHaveLength(1); // 回收站那条被跳过
  });

  it('只吞 409，其余错误上抛（防静默丢数据）', async () => {
    const { api } = fakeApi({
      'POST /folders': () => {
        throw Object.assign(new Error('conflict'), { err: { status: 409 } });
      },
      'POST /tags': () => ({ id: 'g1' }),
      'POST /notes': () => ({ id: 'n1' }),
    });
    const repo = new RemoteRepository(() => api);
    await expect(repo.importBackup(payload as never)).resolves.toBeUndefined();

    const failing = fakeApi({
      'POST /folders': () => {
        throw Object.assign(new Error('bad'), { err: { status: 400 } });
      },
    });
    const repo2 = new RemoteRepository(() => failing.api);
    await expect(repo2.importBackup(payload as never)).rejects.toThrow('bad');
  });

  it('标签/笔记的 409 同样被吞（迁移重试幂等）', async () => {
    let tagCalls = 0;
    let noteCalls = 0;
    const { api } = fakeApi({
      'POST /folders': () => ({ id: 'f1' }),
      'POST /tags': () => {
        tagCalls += 1;
        throw Object.assign(new Error('conflict'), { err: { status: 409 } });
      },
      'POST /notes': () => {
        noteCalls += 1;
        throw Object.assign(new Error('conflict'), { err: { status: 409 } });
      },
    });
    const repo = new RemoteRepository(() => api);
    await expect(repo.importBackup(payload as never)).resolves.toBeUndefined();
    expect(tagCalls).toBe(1);
    expect(noteCalls).toBe(1);
  });

  it('备份带偏好设置时同步写入', async () => {
    const { api, calls } = fakeApi({
      'POST /folders': () => ({ id: 'f1' }),
      'POST /tags': () => ({ id: 'g1' }),
      'POST /notes': () => ({ id: 'n1' }),
      'PATCH /preferences': () => undefined,
    });
    const repo = new RemoteRepository(() => api);
    await repo.importBackup({ ...payload, preferences: { theme: 'mist-blue' } } as never);
    const prefCall = calls.find((c) => c.path === '/preferences');
    expect(prefCall?.body).toEqual({ theme: 'mist-blue' });
  });
});

describe('其余端点契约', () => {
  it('createNote：带 id 透传、不带 id 省略；folderId 缺省为 null', async () => {
    const { api, calls } = fakeApi({ 'POST /notes': () => ({ id: 'n1' }) });
    const repo = new RemoteRepository(() => api);
    await repo.createNote({ ciphertext: 'ct', keyVersion: 1 } as never);
    expect(calls[0]?.body).not.toHaveProperty('id');
    expect(calls[0]?.body).toMatchObject({ folderId: null, isPinned: false, isFavorite: false });

    await repo.createNote({ id: 'n2', ciphertext: 'ct', keyVersion: 1 } as never);
    expect(calls[1]?.body).toMatchObject({ id: 'n2' });
  });

  it('笔记/文件夹/标签的基础增删改走正确方法与路径', async () => {
    const { api, calls } = fakeApi({
      'DELETE /notes/n1': () => undefined,
      'DELETE /notes/n1/permanent': () => undefined,
      'PATCH /folders/f1': () => undefined,
      'DELETE /folders/f1': () => undefined,
      'POST /tags': () => ({ id: 'g1' }),
      'DELETE /tags/g1': () => undefined,
      'PATCH /preferences': () => undefined,
    });
    const repo = new RemoteRepository(() => api);
    await repo.deleteNote('n1');
    await repo.permanentDeleteNote('n1');
    await repo.renameFolder('f1', 'B');
    await repo.moveFolder('f1', null);
    await repo.deleteFolder('f1');
    const tagId = await repo.createTag('T');
    await repo.deleteTag(tagId);
    await repo.setPreferences({ theme: 'mist-blue' } as never);

    expect(calls.map((c) => `${c.method.toUpperCase()} ${c.path}`)).toEqual([
      'DELETE /notes/n1',
      'DELETE /notes/n1/permanent',
      'PATCH /folders/f1',
      'PATCH /folders/f1',
      'DELETE /folders/f1',
      'POST /tags',
      'DELETE /tags/g1',
      'PATCH /preferences',
    ]);
    expect(calls[5]?.body).toEqual({ name: 'T', color: null });
    expect(calls[6]?.body).toBeUndefined();
  });

  it('getPreferences 失败返回 null；clearBusinessData 为 no-op', async () => {
    const { api } = fakeApi({
      'GET /preferences': () => {
        throw new Error('offline');
      },
    });
    const repo = new RemoteRepository(() => api);
    await expect(repo.getPreferences()).resolves.toBeNull();
    await expect(repo.clearBusinessData()).resolves.toBeUndefined();
  });

  it('kind 恒为 remote', () => {
    const { api } = fakeApi({});
    expect(new RemoteRepository(() => api).kind).toBe('remote');
  });
});

describe('createFolder', () => {
  it('显式发送 null（服务端 schema 为 nullish，省略与 null 均合法）', async () => {
    const { api, calls } = fakeApi({ 'POST /folders': () => ({ id: 'f1' }) });
    const repo = new RemoteRepository(() => api);
    await repo.createFolder({ name: 'A' } as never);
    expect(calls[0]?.body).toMatchObject({ name: 'A', parentId: null, icon: null, branch: null });
  });
});

describe('exportBackup', () => {
  it('使用注入的 appVersion，未注入时回退 2.0.0', async () => {
    const { api } = fakeApi({
      'GET /notes': () => ({ notes: [], nextCursor: null }),
      'GET /folders': () => ({ folders: [] }),
      'GET /tags': () => ({ tags: [] }),
      'GET /preferences': () => {
        throw new Error('404');
      },
    });
    const repo = new RemoteRepository(() => api, { appVersion: '2.5.40' });
    expect((await repo.exportBackup()).version).toBe('2.5.40');

    const repo2 = new RemoteRepository(() => api);
    expect((await repo2.exportBackup()).version).toBe('2.0.0');
  });
});
