/**
 * 舞台状态机契约测试（UI 阶段 2.8）
 *
 * 这里锁的是"哪种事实落到哪一态、Esc 按下去做什么"，不是像素。
 * 特别锁两条容易在后续重构里被人顺手改回去的：
 *   1. detail 压在 search 之上（否则点开命中会被结果列表弹回去）
 *   2. 概览只属于 destination='overview'，不再靠"有没有范围"猜
 */
import { describe, it, expect } from 'vitest';
import {
  resolveStage,
  nextOnEscape,
  scopeBack,
  stepInSet,
  stagePosition,
  stageHasBack,
  type StageInput,
} from './stage';

const S = (over: Partial<StageInput> = {}): StageInput => ({
  destination: 'overview',
  searchQuery: '',
  selectedNoteId: null,
  selectedFolderId: null,
  selectedTag: null,
  ...over,
});

describe('resolveStage', () => {
  it('首屏落在概览（目的地没选 = 还没决定看哪一堆）', () =>
    expect(resolveStage(S())).toBe('overview'));
  it('点「全部笔记」就是列表态，不再退回概览', () =>
    expect(resolveStage(S({ destination: 'all' }))).toBe('list'));
  it('选中文件夹 → 列表态', () =>
    expect(resolveStage(S({ destination: 'all', selectedFolderId: 'f-1' }))).toBe('list'));
  it('收藏 / 回收站 → 列表态', () => {
    expect(resolveStage(S({ destination: 'favorites' }))).toBe('list');
    expect(resolveStage(S({ destination: 'trash' }))).toBe('list');
  });
  it('选了标签就是列表态，哪怕目的地还停在概览', () =>
    expect(resolveStage(S({ destination: 'overview', selectedTag: '工作' }))).toBe('list'));
  it('打开笔记进详情', () => expect(resolveStage(S({ selectedNoteId: 'n-1' }))).toBe('detail'));
  it('详情压过搜索：从命中里点开一条，看到的是正文而不是被弹回结果列表', () =>
    expect(
      resolveStage(S({ destination: 'all', selectedNoteId: 'n-1', searchQuery: '密钥' }))
    ).toBe('detail'));
  it('有查询词但没打开笔记 → 搜索态', () =>
    expect(resolveStage(S({ destination: 'all', searchQuery: '密钥' }))).toBe('search'));
  it('只有空格的搜索不算搜索（避免误判成空结果页）', () =>
    expect(resolveStage(S({ destination: 'overview', searchQuery: ' ' }))).toBe('overview'));
});

describe('nextOnEscape（Esc 逐级回退要做的动作）', () => {
  it('详情态先关正文，哪怕查询词还在框里', () =>
    expect(nextOnEscape(S({ selectedNoteId: 'n-1', searchQuery: '密钥' }))).toBe('close-detail'));
  it('搜索态清查询词', () =>
    expect(nextOnEscape(S({ destination: 'all', searchQuery: '密钥' }))).toBe('clear-search'));
  it('子范围（收藏 / 回收站 / 文件夹）先回根列表', () => {
    expect(nextOnEscape(S({ destination: 'favorites' }))).toBe('clear-scope');
    expect(nextOnEscape(S({ destination: 'trash' }))).toBe('clear-scope');
    expect(nextOnEscape(S({ destination: 'all', selectedFolderId: 'f-1' }))).toBe('clear-scope');
    expect(nextOnEscape(S({ destination: 'all', selectedTag: '工作' }))).toBe('clear-scope');
  });
  it('根列表与概览是终点，再按 Esc 不动作', () => {
    expect(nextOnEscape(S({ destination: 'all' }))).toBe('stay');
    expect(nextOnEscape(S())).toBe('stay');
  });
});

describe('scopeBack（clear-scope 的回退落点）', () => {
  it('子范围回到「全部笔记」根列表', () => {
    expect(scopeBack(S({ destination: 'favorites' }))).toBe('all');
    expect(scopeBack(S({ destination: 'all', selectedFolderId: 'f-1' }))).toBe('all');
  });
  it('已经在根列表时回概览', () => expect(scopeBack(S({ destination: 'all' }))).toBe('overview'));
  it('带标签也算子范围：回根列表，而不是直接跳概览', () =>
    expect(scopeBack(S({ destination: 'all', selectedTag: '工作' }))).toBe('all'));
});

describe('stepInSet（结果集内翻篇）', () => {
  const ids = ['a', 'b', 'c'] as const;
  it('中间项前后移动', () => {
    expect(stepInSet(ids, 'b', 1)).toBe('c');
    expect(stepInSet(ids, 'b', -1)).toBe('a');
  });
  it('到边界停住而不是循环', () => {
    expect(stepInSet(ids, 'c', 1)).toBe('c');
    expect(stepInSet(ids, 'a', -1)).toBe('a');
  });
  it('当前项不在集合里时，前进取首个、后退取末个', () => {
    expect(stepInSet(ids, 'zz', 1)).toBe('a');
    expect(stepInSet(ids, 'zz', -1)).toBe('c');
    expect(stepInSet(ids, null, 1)).toBe('a');
  });
  it('空集合返回 null', () => expect(stepInSet([] as const, null, 1)).toBeNull());
});

describe('stagePosition（舞台头部的 ‹ 3/11 ›）', () => {
  it('在结果集里报第几篇 / 共几篇', () =>
    expect(stagePosition(['a', 'b', 'c'], 'b')).toEqual({ index: 2, total: 3 }));
  it('从概览的最近编辑点进来时不显示位置（它不属于任何结果集）', () => {
    expect(stagePosition(['a', 'b'], 'zz')).toBeNull();
    expect(stagePosition([], 'a')).toBeNull();
    expect(stagePosition(['a'], null)).toBeNull();
  });
});

describe('stageHasBack', () => {
  it('只有详情需要返回', () => {
    expect(stageHasBack('detail')).toBe(true);
    expect(stageHasBack('list')).toBe(false);
    expect(stageHasBack('search')).toBe(false);
    expect(stageHasBack('overview')).toBe(false);
  });
});
