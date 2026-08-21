import { describe, it, expect } from 'vitest';
import {
  resolveConflict,
  toMergeable,
  type MergeableNote,
} from '../src/conflict.js';

function mk(
  id: string,
  title: string,
  content: string,
  tags: string[],
  extra: Partial<MergeableNote> = {}
): MergeableNote {
  return {
    id,
    plaintext: { title, content, tags },
    isPinned: false,
    isFavorite: false,
    deletedAt: null,
    folderId: null,
    clientUpdatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

describe('resolveConflict', () => {
  it('both sides unchanged → base, no conflicts', () => {
    const base = mk('1', 't', 'c', ['a']);
    const res = resolveConflict(base, base, base);
    expect(res.hasConflicts).toBe(false);
    expect(res.conflicts).toHaveLength(0);
    expect(res.merged.plaintext.title).toBe('t');
  });

  it('only local changed title → local wins, no conflict', () => {
    const base = mk('1', 't', 'c', ['a']);
    const local = mk('1', 't-local', 'c', ['a']);
    const server = mk('1', 't', 'c', ['a']);
    const res = resolveConflict(base, local, server);
    expect(res.hasConflicts).toBe(false);
    expect(res.merged.plaintext.title).toBe('t-local');
  });

  it('only server changed content → server wins, no conflict', () => {
    const base = mk('1', 't', 'c', ['a']);
    const local = mk('1', 't', 'c', ['a']);
    const server = mk('1', 't', 'c-server', ['a']);
    const res = resolveConflict(base, local, server);
    expect(res.hasConflicts).toBe(false);
    expect(res.merged.plaintext.content).toBe('c-server');
  });

  it('both changed title → conflict, merged keeps local', () => {
    const base = mk('1', 't', 'c', ['a']);
    const local = mk('1', 't-local', 'c', ['a']);
    const server = mk('1', 't-server', 'c', ['a']);
    const res = resolveConflict(base, local, server);
    expect(res.hasConflicts).toBe(true);
    const titleConflict = res.conflicts.find((f) => f.field === 'title');
    expect(titleConflict).toBeDefined();
    expect(titleConflict?.localValue).toBe('t-local');
    expect(titleConflict?.serverValue).toBe('t-server');
    // 保住用户未保存的编辑
    expect(res.merged.plaintext.title).toBe('t-local');
  });

  it('local edits content, server edits title → non-conflicting, both applied', () => {
    const base = mk('1', 't', 'c', ['a']);
    const local = mk('1', 't', 'c-local', ['a']);
    const server = mk('1', 't-server', 'c', ['a']);
    const res = resolveConflict(base, local, server);
    expect(res.hasConflicts).toBe(false);
    expect(res.merged.plaintext.title).toBe('t-server');
    expect(res.merged.plaintext.content).toBe('c-local');
  });

  it('both changed tags → conflict, merged = union, suggested = union', () => {
    const base = mk('1', 't', 'c', ['a', 'b']);
    const local = mk('1', 't', 'c', ['a', 'x']);
    const server = mk('1', 't', 'c', ['b', 'y']);
    const res = resolveConflict(base, local, server);
    expect(res.hasConflicts).toBe(true);
    const tagsConflict = res.conflicts.find((f) => f.field === 'tags');
    expect(tagsConflict).toBeDefined();
    const suggested = tagsConflict?.suggested as string[];
    expect(suggested.sort()).toEqual(['a', 'b', 'x', 'y']);
    expect(res.merged.plaintext.tags.sort()).toEqual(['a', 'b', 'x', 'y']);
  });

  it('only one side changed tags → that side wins, no conflict', () => {
    const base = mk('1', 't', 'c', ['a']);
    const local = mk('1', 't', 'c', ['a', 'b']);
    const server = mk('1', 't', 'c', ['a']);
    const res = resolveConflict(base, local, server);
    expect(res.hasConflicts).toBe(false);
    expect(res.merged.plaintext.tags).toEqual(['a', 'b']);
  });

  it('tags reorder only → no conflict (order-insensitive)', () => {
    const base = mk('1', 't', 'c', ['a', 'b']);
    const local = mk('1', 't', 'c', ['b', 'a']);
    const server = mk('1', 't', 'c', ['a', 'b']);
    const res = resolveConflict(base, local, server);
    expect(res.hasConflicts).toBe(false);
  });

  it('metadata: local pins, server favorites → both applied, no conflict', () => {
    const base = mk('1', 't', 'c', ['a']);
    const local = mk('1', 't', 'c', ['a'], { isPinned: true });
    const server = mk('1', 't', 'c', ['a'], { isFavorite: true });
    const res = resolveConflict(base, local, server);
    expect(res.hasConflicts).toBe(false);
    expect(res.merged.isPinned).toBe(true);
    expect(res.merged.isFavorite).toBe(true);
  });

  it('both changed folderId to different values → conflict', () => {
    const base = mk('1', 't', 'c', ['a'], { folderId: 'f1' });
    const local = mk('1', 't', 'c', ['a'], { folderId: 'f2' });
    const server = mk('1', 't', 'c', ['a'], { folderId: 'f3' });
    const res = resolveConflict(base, local, server);
    expect(res.hasConflicts).toBe(true);
    expect(res.conflicts.find((f) => f.field === 'folderId')).toBeDefined();
    expect(res.merged.folderId).toBe('f2'); // 保 local
  });

  it('both changed isPinned to the same value → agree, no conflict', () => {
    const base = mk('1', 't', 'c', ['a'], { isPinned: false });
    const local = mk('1', 't', 'c', ['a'], { isPinned: true });
    const server = mk('1', 't', 'c', ['a'], { isPinned: true });
    const res = resolveConflict(base, local, server);
    expect(res.hasConflicts).toBe(false);
    expect(res.merged.isPinned).toBe(true);
  });

  it('delete-vs-edit: server deleted, local edited content → conflict, merged keeps local (not deleted)', () => {
    const base = mk('1', 't', 'c', ['a']);
    const local = mk('1', 't', 'c-edited', ['a']);
    const server = mk('1', 't', 'c', ['a'], { deletedAt: '2026-01-02T00:00:00Z' });
    const res = resolveConflict(base, local, server);
    expect(res.hasConflicts).toBe(true);
    const del = res.conflicts.find((f) => f.field === 'deletedAt');
    expect(del).toBeDefined();
    // 不丢编辑：merged 未删除
    expect(res.merged.deletedAt).toBeNull();
    expect(res.merged.plaintext.content).toBe('c-edited');
  });

  it('toMergeable builds a MergeableNote', () => {
    const m = toMergeable(
      'n1',
      { title: 't', content: 'c', tags: [] },
      { isPinned: true, isFavorite: false, deletedAt: null, folderId: 'f1', clientUpdatedAt: 'ts' }
    );
    expect(m.id).toBe('n1');
    expect(m.isPinned).toBe(true);
    expect(m.folderId).toBe('f1');
    expect(m.plaintext.title).toBe('t');
  });
});
