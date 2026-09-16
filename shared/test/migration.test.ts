/**
 * 迁移策略层单测（技术债清理：账本逻辑此前在 mobile / 小程序各复制一份且零覆盖，
 * 连续三轮审计都在这些边界上出过缺陷）
 */
import { describe, it, expect, vi } from 'vitest';
import {
  MAX_MIGRATION_ATTEMPTS,
  openMigrationAttempt,
  runFolderImport,
  runNoteImport,
  convertNotesForStandalone,
  canClearSlot,
  type NoteImportDeps,
  type MigrationLedgerState,
  type NoteCreateRequest,
} from '../src/migration.js';
import type { NoteRow, Folder } from '../src/types.js';

/** 造一条笔记行（只填策略层读得到的字段） */
function note(id: string, over: Partial<NoteRow> = {}): NoteRow {
  return {
    id,
    ciphertext: `ct-${id}`,
    keyVersion: 1,
    isPinned: false,
    isFavorite: false,
    deletedAt: null,
    version: 1,
    clientUpdatedAt: '2026-09-16 10:00:00',
    serverUpdatedAt: '2026-09-16 10:00:00',
    folderId: null,
    ...over,
  };
}

function folder(id: string, parentId: string | null = null): Folder {
  return {
    id,
    name: `f-${id}`,
    parentId,
    icon: null,
    sortOrder: 0,
    createdAt: '2026-09-16 10:00:00',
  };
}

/**
 * 造注入依赖。默认：所有笔记可解密、创建必成功。
 * `undecryptable` 里的 id 解密返回 null（模拟密文损坏 / 密钥不匹配单条）。
 */
function makeDeps(
  over: {
    undecryptable?: readonly string[];
    createNote?: (input: NoteCreateRequest) => Promise<unknown>;
    persistLedger?: (state: MigrationLedgerState) => Promise<void> | void;
  } = {}
): NoteImportDeps {
  const dead = new Set(over.undecryptable ?? []);
  return {
    decrypt: async (n) => (dead.has(n.id) ? null : `{"t":"${n.id}"}`),
    reEncrypt: async (json) => `re:${json}`,
    createNote: over.createNote ?? (async () => undefined),
    persistLedger: over.persistLedger ?? (() => undefined),
  };
}

describe('openMigrationAttempt', () => {
  it('自增轮次且不改动入参', () => {
    const slot = { attempts: 1, failedIds: ['a'] };
    expect(openMigrationAttempt(slot)).toEqual({ attempts: 2, exhausted: false, failedCount: 1 });
    expect(slot.attempts).toBe(1);
  });

  it('首次迁移视作第 1 轮，未超限', () => {
    expect(openMigrationAttempt({})).toEqual({ attempts: 1, exhausted: false, failedCount: 0 });
  });

  it(`第 ${MAX_MIGRATION_ATTEMPTS} 轮仍可重试，第 ${MAX_MIGRATION_ATTEMPTS + 1} 轮起放弃`, () => {
    expect(openMigrationAttempt({ attempts: MAX_MIGRATION_ATTEMPTS - 1 }).exhausted).toBe(false);
    expect(openMigrationAttempt({ attempts: MAX_MIGRATION_ATTEMPTS }).exhausted).toBe(true);
  });

  it('超限时带出确定性失败数供报告使用', () => {
    const gate = openMigrationAttempt({ attempts: MAX_MIGRATION_ATTEMPTS, failedIds: ['a', 'b'] });
    expect(gate.exhausted).toBe(true);
    expect(gate.failedCount).toBe(2);
  });
});

describe('runNoteImport', () => {
  it('全部成功：计数正确、账本收全', async () => {
    const notes = [note('n1'), note('n2'), note('n3')];
    const out = await runNoteImport({ notes, folderMap: new Map(), deps: makeDeps() });
    expect(out.imported).toBe(3);
    expect(out.failed).toBe(0);
    expect(out.unresolved).toBe(0);
    expect(out.importedIds.sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('跳过软删笔记：不进账本也不算失败（不复活回收站垃圾）', async () => {
    const created: string[] = [];
    const deps = makeDeps({
      createNote: async (i) => {
        created.push(i.id);
      },
    });
    const out = await runNoteImport({
      notes: [note('n1'), note('n2', { deletedAt: '2026-09-01 00:00:00' })],
      folderMap: new Map(),
      deps,
    });
    expect(created).toEqual(['n1']);
    expect(out.importedIds).toEqual(['n1']);
    expect(out.failed).toBe(0);
  });

  it('已导入的 id 不重传（重试幂等；也不复活用户已永久删除的笔记）', async () => {
    const created: string[] = [];
    const deps = makeDeps({
      createNote: async (i) => {
        created.push(i.id);
      },
    });
    const out = await runNoteImport({
      notes: [note('n1'), note('n2')],
      folderMap: new Map(),
      importedIds: ['n1'],
      deps,
    });
    expect(created).toEqual(['n2']);
    expect(out.imported).toBe(1);
    expect(out.importedIds.sort()).toEqual(['n1', 'n2']);
  });

  it('文件夹映射生效，未命中则落入未分类', async () => {
    const seen: NoteCreateRequest[] = [];
    const deps = makeDeps({
      createNote: async (i) => {
        seen.push(i);
      },
    });
    await runNoteImport({
      notes: [note('n1', { folderId: 'old-f' }), note('n2', { folderId: 'unknown' }), note('n3')],
      folderMap: new Map([['old-f', 'new-f']]),
      deps,
    });
    expect(seen.map((i) => i.folderId)).toEqual(['new-f', null, null]);
  });

  it('创建失败（暂时性）计入本轮 failed，但不记确定性账 → 下轮可重试', async () => {
    let failNext = true;
    const created: string[] = [];
    const deps = makeDeps({
      createNote: async (i) => {
        if (failNext) throw new Error('network');
        created.push(i.id);
      },
    });
    const first = await runNoteImport({ notes: [note('n1')], folderMap: new Map(), deps });
    expect(first.failed).toBe(1);
    expect(first.imported).toBe(0);
    expect(first.unresolved).toBe(0); // 关键：不能记成确定性失败
    expect(first.failedIds).toEqual([]);

    failNext = false;
    const second = await runNoteImport({
      notes: [note('n1')],
      folderMap: new Map(),
      deps,
    });
    expect(second.imported).toBe(1);
    expect(created).toEqual(['n1']);
  });

  it('确定性解密失败：密钥被其他笔记证实正确时才记账', async () => {
    const out = await runNoteImport({
      notes: [note('ok1'), note('bad'), note('ok2')],
      folderMap: new Map(),
      deps: makeDeps({ undecryptable: ['bad'] }),
    });
    expect(out.imported).toBe(2);
    expect(out.failed).toBe(1);
    expect(out.failedIds).toEqual(['bad']);
    expect(out.unresolved).toBe(1);
  });

  it('全部解密失败（密钥不对）**不**记确定性账 —— 否则换对密钥后永远迁不回来', async () => {
    const out = await runNoteImport({
      notes: [note('n1'), note('n2')],
      folderMap: new Map(),
      deps: makeDeps({ undecryptable: ['n1', 'n2'] }),
    });
    expect(out.imported).toBe(0);
    expect(out.failed).toBe(2);
    expect(out.failedIds).toEqual([]); // 关键：不记账
    expect(out.unresolved).toBe(0);
  });

  it('已知确定性失败的 id 重试时只付本地解密代价，不发网络请求', async () => {
    const createNote = vi.fn(async () => undefined);
    const out = await runNoteImport({
      notes: [note('bad')],
      folderMap: new Map(),
      failedIds: ['bad'],
      deps: makeDeps({ undecryptable: ['bad'], createNote }),
    });
    // 解不出 → 直接 continue，不会去建笔记（零网络开销）
    expect(createNote).not.toHaveBeenCalled();
    expect(out.unresolved).toBe(1);
    expect(out.failed).toBe(1);
  });

  it('后续轮次成功导入的 id 会从失败账本中移除', async () => {
    const out = await runNoteImport({
      notes: [note('n1')],
      folderMap: new Map(),
      failedIds: ['n1'],
      deps: makeDeps({ undecryptable: ['n1'] }),
    });
    // 本轮仍失败 → 保留
    expect(out.failedIds).toEqual(['n1']);

    const out2 = await runNoteImport({
      notes: [note('n1')],
      folderMap: new Map(),
      failedIds: ['n1'],
      deps: makeDeps(),
    });
    expect(out2.failedIds).toEqual([]);
    expect(out2.unresolved).toBe(0);
  });

  it('账本按间隔落盘，且收尾必落一次', async () => {
    const snapshots: number[] = [];
    const deps = makeDeps({
      persistLedger: (s: MigrationLedgerState) => {
        snapshots.push(s.importedIds.length);
      },
    });
    await runNoteImport({
      notes: [note('n1'), note('n2'), note('n3'), note('n4'), note('n5')],
      folderMap: new Map(),
      deps,
      flushInterval: 2,
    });
    // 2 条时落一次、4 条时落一次、收尾 5 条落一次
    expect(snapshots).toEqual([2, 4, 5]);
  });

  it('账本落盘抛异常不致命（最坏重传最近若干条，服务端幂等收敛）', async () => {
    const out = await runNoteImport({
      notes: [note('n1')],
      folderMap: new Map(),
      deps: makeDeps({
        persistLedger: () => {
          throw new Error('storage full');
        },
      }),
      flushInterval: 1,
    });
    expect(out.imported).toBe(1);
    expect(out.importedIds).toEqual(['n1']);
  });
});

describe('canClearSlot', () => {
  it('无失败且无历史未解决项 → 可清除', () => {
    expect(canClearSlot({ failed: 0, unresolved: 0 })).toBe(true);
  });

  it('本轮有失败 → 保留槽（下轮重试）', () => {
    expect(canClearSlot({ failed: 1, unresolved: 0 })).toBe(false);
  });

  it('本轮无失败但仍有历史确定性失败 → 保留槽（否则报告与失败笔记一起丢失）', () => {
    expect(canClearSlot({ failed: 0, unresolved: 2 })).toBe(false);
  });
});

describe('runFolderImport', () => {
  it('先父后子建立映射，已映射的跳过（重试不重复建）', async () => {
    const calls: string[] = [];
    let seq = 0;
    const map = new Map<string, string>([['f1', 'existing']]);
    await runFolderImport([folder('f1'), folder('f2'), folder('f3', 'f2')], map, async (input) => {
      calls.push(`${input.name}<-${input.parentId ?? 'root'}`);
      return `new${++seq}`;
    });
    expect(calls).toEqual(['f-f2<-root', 'f-f3<-new1']);
    expect(map.get('f1')).toBe('existing');
    expect(map.get('f3')).toBe('new2');
  });

  it('单条失败不中断整体，其子文件夹回落顶层', async () => {
    const map = new Map<string, string>();
    await runFolderImport([folder('f1'), folder('f2', 'f1')], map, async (input) => {
      if (input.name === 'f-f1') throw new Error('boom');
      return 'new-f2';
    });
    expect(map.has('f1')).toBe(false);
    expect(map.get('f2')).toBe('new-f2');
  });
});

describe('convertNotesForStandalone', () => {
  it('解不出的条目被剔除并计数，其余换成重加密密文', async () => {
    const out = await convertNotesForStandalone(
      [note('n1'), note('bad'), note('n2')],
      makeDeps({ undecryptable: ['bad'] })
    );
    expect(out.failed).toBe(1);
    expect(out.notes.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(out.notes.every((n) => n.ciphertext.startsWith('re:') && n.keyVersion === 1)).toBe(true);
  });
});
