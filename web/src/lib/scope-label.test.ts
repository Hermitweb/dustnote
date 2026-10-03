import { describe, it, expect } from 'vitest';
import { UNFILED_ID } from './store-types';
import { scopeLabel, type ScopeLabels } from './scope-label';

const L: ScopeLabels = {
  overview: '概览',
  all: '全部笔记',
  favorites: '收藏',
  trash: '回收站',
  unfiled: '未分类',
};
const base = { selectedFolderId: null, folderNames: { f1: '工作', f2: '个人' } };

describe('scopeLabel：顶栏常驻的"我在哪"', () => {
  it('四个目的地各自的名字', () => {
    expect(scopeLabel({ ...base, viewMode: 'overview' }, L)).toBe('概览');
    expect(scopeLabel({ ...base, viewMode: 'favorites' }, L)).toBe('收藏');
    expect(scopeLabel({ ...base, viewMode: 'trash' }, L)).toBe('回收站');
    expect(scopeLabel({ ...base, viewMode: 'all' }, L)).toBe('全部笔记');
  });

  it('选中文件夹时显示文件夹名（这才是图标轨档读不到的那部分信息）', () => {
    expect(scopeLabel({ ...base, viewMode: 'all', selectedFolderId: 'f2' }, L)).toBe('个人');
  });

  it('未分类走专门文案，不显示内部 id', () => {
    expect(scopeLabel({ ...base, viewMode: 'all', selectedFolderId: UNFILED_ID }, L)).toBe(
      '未分类'
    );
  });

  it('文件夹已被别端删除时回落，而不是把 undefined 印在顶栏', () => {
    expect(scopeLabel({ ...base, viewMode: 'all', selectedFolderId: 'gone' }, L)).toBe('全部笔记');
  });

  it('未知 viewMode 也必须有名字（新增档位时这条会提醒补分支）', () => {
    expect(scopeLabel({ ...base, viewMode: 'whatever' as never }, L)).toBe('全部笔记');
  });
});
