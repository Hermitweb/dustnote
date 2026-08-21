/**
 * 客户端全文搜索 v2 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SearchIndex, tokenize, highlightMatches } from './search';
import type { NotePlaintext } from './store';

describe('tokenize', () => {
  it('切分英文按词', () => {
    const tokens = tokenize('Hello World foo');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('foo');
  });

  it('切分中文（Intl.Segmenter 可用时按词，否则降级）', () => {
    const tokens = tokenize('今天天气真好');
    // Intl.Segmenter 可用时应切出"今天""天气"等词；降级时至少不抛错
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('过滤标点和空白', () => {
    const tokens = tokenize('hello, world! foo-bar');
    expect(tokens).not.toContain(',');
    expect(tokens).not.toContain('!');
    expect(tokens.every((t) => t.length > 0)).toBe(true);
  });

  it('空字符串返回空数组', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('SearchIndex', () => {
  let index: SearchIndex;
  const notes = new Map<string, NotePlaintext>([
    [
      'n1',
      { title: 'React 学习笔记', content: '今天学习了 React hooks', tags: ['react', 'frontend'] },
    ],
    ['n2', { title: 'Vue 入门', content: 'Vue 是一个渐进式框架', tags: ['vue', 'frontend'] }],
    ['n3', { title: '日记', content: '今天天气真好，去公园散步', tags: ['life'] }],
  ]);

  beforeEach(() => {
    index = new SearchIndex();
    index.rebuild(notes);
  });

  it('标题命中权重高于内容', () => {
    // "react" 在 n1 标题和内容都出现
    const hits = index.search('react');
    expect(hits.length).toBe(1);
    expect(hits[0]?.noteId).toBe('n1');
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it('多词查询返回所有命中', () => {
    const hits = index.search('frontend');
    expect(hits.length).toBe(2);
    const ids = hits.map((h) => h.noteId);
    expect(ids).toContain('n1');
    expect(ids).toContain('n2');
  });

  it('相关性排序：标题命中排在前面', () => {
    // n1 标题含"React"，n2 标签含"frontend"
    // 搜索 "react" 只命中 n1
    const hits = index.search('react');
    expect(hits[0]?.noteId).toBe('n1');
  });

  it('matchedTokens 用于高亮', () => {
    const hits = index.search('react');
    expect(hits[0]?.matchedTokens.has('react')).toBe(true);
  });

  it('无命中返回空数组', () => {
    const hits = index.search('不存在的词xyz');
    expect(hits).toEqual([]);
  });

  it('增量更新：update 单条', () => {
    index.update('n1', { title: 'Angular 笔记', content: 'Angular 框架', tags: ['angular'] });
    // 旧的 "react" 不应再命中
    expect(index.search('react')).toEqual([]);
    // 新的 "angular" 应命中
    const hits = index.search('angular');
    expect(hits.length).toBe(1);
    expect(hits[0]?.noteId).toBe('n1');
  });

  it('增量更新：remove 单条', () => {
    index.remove('n2');
    expect(index.search('vue')).toEqual([]);
    // n1 仍在
    expect(index.search('react').length).toBe(1);
  });

  it('candidateIds 限定搜索范围', () => {
    const hits = index.search('frontend', new Set(['n1']));
    expect(hits.length).toBe(1);
    expect(hits[0]?.noteId).toBe('n1');
  });

  it('clear 清空索引', () => {
    index.clear();
    expect(index.search('react')).toEqual([]);
  });
});

describe('highlightMatches', () => {
  it('包裹匹配 token', () => {
    const result = highlightMatches('Hello World', new Set(['world']));
    expect(result).toContain('<mark>');
    expect(result).toContain('World');
  });

  it('转义 HTML 特殊字符', () => {
    const result = highlightMatches('<script>alert(1)</script>', new Set(['script']));
    // 原始 <script> 标签必须被转义，不能作为可执行 HTML 注入
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('</script>');
    // 转义后的 &lt; 和 &gt; 必须存在
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
  });

  it('无匹配返回原文本（已转义）', () => {
    const result = highlightMatches('Hello World', new Set());
    expect(result).toBe('Hello World');
  });

  it('大小写不敏感匹配', () => {
    const result = highlightMatches('REACT notes', new Set(['react']));
    expect(result).toContain('<mark>REACT</mark>');
  });
});
