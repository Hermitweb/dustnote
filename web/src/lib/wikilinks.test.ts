/**
 * wikilinks 测试
 */
import { describe, it, expect } from 'vitest';
import { wikilinkExtension, extractWikilinks, buildBacklinkIndex } from './wikilinks';
import { marked } from 'marked';

// marked extension 实际的 start/tokenizer/renderer 通过类型断言访问
const extAny = wikilinkExtension as unknown as {
  start: (src: string) => number | undefined;
};

describe('wikilinks', () => {
  describe('extractWikilinks', () => {
    it('提取单条 wikilink', () => {
      expect(extractWikilinks('hello [[note title]] world')).toEqual(['note title']);
    });

    it('提取多 wikilink + 去重', () => {
      const text = 'see [[a]] and [[b]] and [[a]] again';
      expect(extractWikilinks(text)).toEqual(['a', 'b']);
    });

    it('解析带分隔符 [[target|display]] 只取 target', () => {
      expect(extractWikilinks('[[target|display]]')).toEqual(['target']);
    });

    it('空内容返回空数组', () => {
      expect(extractWikilinks('')).toEqual([]);
    });

    it('内容里没有 wikilink 返回空', () => {
      expect(extractWikilinks('just plain text')).toEqual([]);
    });
  });

  describe('buildBacklinkIndex', () => {
    it('索引：每条 wikilink 形成 source→target 反向关系', () => {
      const notes = new Map([
        ['n1', { id: 'n1', title: '关于尘渊', links: ['相关笔记'] }],
        ['n2', { id: 'n2', title: '相关笔记', links: [] }],
        ['n3', { id: 'n3', title: '其他', links: ['相关笔记'] }],
      ]);
      const idx = buildBacklinkIndex(notes);
      const bls = idx.get('相关笔记') ?? [];
      expect(bls.length).toBe(2);
      expect(bls.map((b) => b.sourceTitle).sort()).toEqual(['关于尘渊', '其他']);
    });

    it('空 notes → 空索引', () => {
      const idx = buildBacklinkIndex(new Map());
      expect(idx.size).toBe(0);
    });
  });

  describe('wikilinkExtension', () => {
    it('把 [[note]] 渲染成 <a class="wikilink">', () => {
      marked.use({ extensions: [wikilinkExtension] });
      const html = marked.parse('see [[note title]] here', { async: false }) as string;
      expect(html).toContain('wikilink');
      expect(html).toContain('data-note-title="note title"');
    });

    it('带分隔符 [[target|text]] 用 text 作为显示', () => {
      marked.use({ extensions: [wikilinkExtension] });
      const html = marked.parse('[[target|display name]]', { async: false }) as string;
      expect(html).toContain('display name');
      expect(html).toContain('data-note-title="target"');
    });

    it('start 函数定位 [[ 位置', () => {
      const idx = extAny.start('xx [[hi');
      expect(idx).toBe(3);
    });

    it('不在 [[ 处时 start 返回 undefined', () => {
      expect(extAny.start('普通文本')).toBeUndefined();
    });
  });
});
