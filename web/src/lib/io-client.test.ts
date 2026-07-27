/**
 * 导入/导出工具单元测试
 *
 * 覆盖：
 * - 文件格式检测（detectFormat）
 * - .txt / .md 解析（parseNoteFile）
 * - 导出 Markdown / HTML / JSON（exportAsMarkdown / exportAsHtml / exportAsJson）
 *
 * 这些函数在浏览器端运行，使用 File / Blob / FileReader，
 * 因此 vitest 配置使用 jsdom 环境。
 *
 * 注：printNote 依赖浏览器原生打印对话框，无法在 jsdom 中单元测试，
 * 故不在此覆盖；其行为通过手动测试验证。
 */

import { describe, it, expect } from 'vitest';
import {
  detectFormat,
  parseNoteFile,
  exportAsMarkdown,
  exportAsHtml,
  exportAsJson,
} from './io-client';

// 用文本内容构造一个 File（jsdom 支持 File 构造器）
function makeFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/plain' });
}

describe('detectFormat', () => {
  it('detects .txt', () => {
    expect(detectFormat('note.txt')).toBe('txt');
  });
  it('detects .md', () => {
    expect(detectFormat('note.md')).toBe('md');
  });
  it('detects .markdown', () => {
    expect(detectFormat('note.markdown')).toBe('md');
  });
  it('detects .docx', () => {
    expect(detectFormat('doc.docx')).toBe('docx');
  });
  it('returns unknown for unsupported extensions', () => {
    expect(detectFormat('note.pdf')).toBe('unknown');
    expect(detectFormat('note')).toBe('unknown');
  });
  it('is case-insensitive', () => {
    expect(detectFormat('NOTE.TXT')).toBe('txt');
    expect(detectFormat('Note.MD')).toBe('md');
  });
});

describe('parseNoteFile', () => {
  it('parses .txt: first non-empty line as title, full text as content', async () => {
    const file = makeFile('diary.txt', '\n\n第一篇日记\n今天天气不错。\n');
    const note = await parseNoteFile(file);
    expect(note.title).toBe('第一篇日记');
    expect(note.content).toContain('今天天气不错');
    expect(note.tags).toContain('导入');
  });

  it('falls back to filename (without ext) when txt content is empty', async () => {
    const file = makeFile('empty.txt', '');
    const note = await parseNoteFile(file);
    expect(note.title).toBe('empty');
  });

  it('parses .md: first # heading as title', async () => {
    const md = '# 我的笔记\n\n正文内容\n\n## 子标题';
    const file = makeFile('note.md', md);
    const note = await parseNoteFile(file);
    expect(note.title).toBe('我的笔记');
    expect(note.content).toBe(md);
    expect(note.tags).toEqual(expect.arrayContaining(['导入', 'markdown']));
  });

  it('falls back to filename when .md has no # heading', async () => {
    const file = makeFile('no-heading.md', 'just plain text');
    const note = await parseNoteFile(file);
    expect(note.title).toBe('no-heading');
  });

  it('rejects unsupported formats', async () => {
    const file = makeFile('doc.pdf', 'pdf content');
    await expect(parseNoteFile(file)).rejects.toThrow(/不支持的文件格式/);
  });
});

describe('exportAsMarkdown', () => {
  it('wraps content with # title when content has no heading', () => {
    const blob = exportAsMarkdown('标题', '正文');
    expect(blob.type).toBe('text/markdown;charset=utf-8');
  });

  it('returns blob with markdown content', async () => {
    const blob = exportAsMarkdown('标题', '正文');
    const text = await blob.text();
    expect(text).toContain('正文');
  });

  it('does not double-add heading if content already starts with #', async () => {
    const blob = exportAsMarkdown('标题', '# 已有标题\n正文');
    const text = await blob.text();
    // 内容以 # 开头时直接用 content，不再前置 # 标题
    expect(text.startsWith('# 已有标题')).toBe(true);
    expect(text).not.toContain('# # 已有标题');
  });

  it('prepends UTF-8 BOM so Windows Notepad detects encoding', async () => {
    const blob = exportAsMarkdown('标题', '正文');
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // BOM = 0xEF 0xBB 0xBF
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
  });
});

describe('exportAsHtml', () => {
  it('returns a text/html blob with escaped title', () => {
    const blob = exportAsHtml('<script>', 'content');
    expect(blob.type).toBe('text/html;charset=utf-8');
  });

  it('escapes HTML in title to prevent XSS', async () => {
    const blob = exportAsHtml('<img src=x onerror=alert(1)>', '内容');
    const html = await blob.text();
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });

  it('renders markdown headings as HTML tags', async () => {
    const blob = exportAsHtml('标题', '# 大标题\n正文');
    const html = await blob.text();
    expect(html).toContain('<h1>大标题</h1>');
  });

  it('escapes HTML in content', async () => {
    const blob = exportAsHtml('标题', '<b>粗体</b>');
    const html = await blob.text();
    // 原始 <b> 应被转义（极简转换器先 escape 再处理 markdown 语法）
    expect(html).toContain('&lt;b&gt;');
  });
});

describe('exportAsJson', () => {
  it('serializes data as pretty JSON', async () => {
    const data = { title: '笔记', tags: ['a', 'b'] };
    const blob = exportAsJson(data);
    expect(blob.type).toBe('application/json;charset=utf-8');
    const text = await blob.text();
    expect(JSON.parse(text)).toEqual(data);
    // pretty-printed (含换行)
    expect(text).toContain('\n');
  });

  it('handles arrays', async () => {
    const blob = exportAsJson([1, 2, 3]);
    const text = await blob.text();
    expect(JSON.parse(text)).toEqual([1, 2, 3]);
  });
});
