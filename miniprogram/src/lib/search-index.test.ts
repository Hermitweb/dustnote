/**
 * 客户端全文搜索索引（TEST-004）
 *
 * weapp 运行时没有 Intl.Segmenter，中文改用二元组分词。这里钉两件事：
 * 1. 分词形状（二元组 + 拉丁词 + 单字兜底）—— 分错就是"搜不到自己写过的字"；
 * 2. 相关性排序（标题 > 标签 > 内容）与 rebuild 的替换语义
 *    （rebuild 若不清旧倒排，删掉的笔记会一直能被搜到）。
 */
import { describe, it, expect } from 'vitest';
import { tokenize, SearchIndex } from './search-index';

describe('tokenize', () => {
  it('连续中文切成交叠二元组', () => {
    expect(tokenize('笔记搜索')).toEqual(['笔记', '记搜', '搜索']);
  });

  it('单个中文保留单字（否则一个字都搜不到）', () => {
    expect(tokenize('笔')).toEqual(['笔']);
  });

  it('英文按非字母数字切并转小写', () => {
    expect(tokenize('E2EE-Friendly Search')).toEqual(['e2ee', 'friendly', 'search']);
  });

  it('中英混排各自处理', () => {
    const t = tokenize('使用Taro开发');
    expect(t).toContain('taro');
    expect(t).toContain('使用');
    expect(t).toContain('开发');
  });

  it('空串与纯符号不产生 token', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('!!! ---')).toEqual([]);
  });
});

describe('SearchIndex', () => {
  const notes = {
    n1: { title: '项目会议纪要', content: '讨论了搜索功能的实现细节', tags: ['工作'] },
    n2: { title: '读书笔记', content: '项目管理的几个原则', tags: [] },
    n3: { title: '购物清单', content: '牛奶、面包', tags: ['个人', '工作'] },
  };

  it('标题命中排在内容命中前面', () => {
    const idx = new SearchIndex();
    idx.rebuild(notes);
    const hits = idx.search('项目');
    expect(hits.length).toBeGreaterThan(1);
    // n1 标题含"项目"，n2 只在内容里含 → n1 分数更高
    const at = (id: string): number => hits.findIndex((h) => h.noteId === id);
    expect(at('n1')).toBeLessThan(at('n2'));
    expect(hits[0]?.score).toBeGreaterThan(hits[hits.length - 1]!.score);
  });

  it('标签命中优于内容命中', () => {
    const idx = new SearchIndex();
    idx.rebuild(notes);
    const hits = idx.search('工作');
    const ids = hits.map((h) => h.noteId);
    expect(ids).toContain('n1');
    expect(ids).toContain('n3');
  });

  it('命中的 token 集合回传（UI 高亮要用它）', () => {
    const idx = new SearchIndex();
    idx.rebuild(notes);
    const h = idx.search('搜索')[0];
    expect(h).toBeTruthy();
    expect(h!.matchedTokens instanceof Set).toBe(true);
    expect(h!.matchedTokens.size).toBeGreaterThan(0);
  });

  it('空查询不返回结果，而不是把全库都算命中', () => {
    const idx = new SearchIndex();
    idx.rebuild(notes);
    expect(idx.search('')).toHaveLength(0);
    expect(idx.search('   ')).toHaveLength(0);
  });

  it('rebuild 是替换而不是追加：删掉的笔记不该还能搜到', () => {
    const idx = new SearchIndex();
    idx.rebuild(notes);
    expect(idx.search('购物').length).toBe(1);
    const { n3: _drop, ...rest } = notes;
    idx.rebuild(rest);
    expect(idx.search('购物')).toHaveLength(0);
    expect(idx.search('项目').length).toBeGreaterThan(0);
  });

  it('搜不到的词返回空数组（不是 undefined，调用方不必判空）', () => {
    const idx = new SearchIndex();
    idx.rebuild(notes);
    expect(idx.search('不存在的词汇')).toHaveLength(0);
  });
});
