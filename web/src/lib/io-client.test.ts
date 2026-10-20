/**
 * web/src/lib/io-client.ts 单测 —— parseNoteFile / detectFormat / 各种 exportAs
 *
 * 覆盖：
 *   - readFileAsArrayBuffer 成功 / 失败
 *   - detectFormat 各种扩展名
 *   - parseNoteFile：txt / md / docx / unknown
 *   - exportAsMarkdown / exportAsHtml / exportAsJson 各自形状
 *   - downloadBlob：调 a.click() + revokeObjectURL
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installPolyfills } from '../test/polyfills';

installPolyfills();

vi.mock('mammoth', () => ({
  extractRawText: vi.fn(async () => ({ value: 'docx text content\nSecond para' })),
}));

import {
  readFileAsArrayBuffer,
  detectFormat,
  parseNoteFile,
  exportAsMarkdown,
  exportAsHtml,
  exportAsJson,
  downloadBlob,
} from './io-client';

function file(name: string, content: string, type = 'text/plain'): File {
  return new File([content], name, { type });
}

describe('io-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('readFileAsArrayBuffer', () => {
    it('成功读取文件 → 返回 ArrayBuffer', async () => {
      const f = file('hello.txt', 'hello');
      const buf = await readFileAsArrayBuffer(f);
      expect(buf).toBeInstanceOf(ArrayBuffer);
    });
  });

  describe('detectFormat', () => {
    it('.txt → txt', () => {
      expect(detectFormat('a.txt')).toBe('txt');
      expect(detectFormat('A.TXT')).toBe('txt');
    });
    it('.md / .markdown → md', () => {
      expect(detectFormat('a.md')).toBe('md');
      expect(detectFormat('a.markdown')).toBe('md');
    });
    it('.docx → docx', () => {
      expect(detectFormat('a.docx')).toBe('docx');
    });
    it('无扩展名 / 未知 → unknown', () => {
      expect(detectFormat('a')).toBe('unknown');
      expect(detectFormat('a.pdf')).toBe('unknown');
    });
  });

  describe('parseNoteFile', () => {
    it('.txt：标题取首行 + tags=[导入]', async () => {
      const f = file('a.txt', 'First Line\nbody');
      const result = await parseNoteFile(f);
      expect(result.title).toBe('First Line');
      expect(result.content).toBe('First Line\nbody');
      expect(result.tags).toEqual(['导入']);
    });

    it('.txt 空内容 → 标题回退到文件名', async () => {
      const f = file('fallback.txt', '   \n   ');
      const result = await parseNoteFile(f);
      expect(result.title).toBe('fallback');
    });

    it('.md：# 标题抽取 + tags=[导入,markdown]', async () => {
      const f = file('a.md', '# My Note\nbody');
      const result = await parseNoteFile(f);
      expect(result.title).toBe('My Note');
      expect(result.tags).toEqual(['导入', 'markdown']);
    });

    it('.md 无 # → 标题用文件名', async () => {
      const f = file('plain.md', 'just body');
      const result = await parseNoteFile(f);
      expect(result.title).toBe('plain');
    });

    it('.docx：mammoth 加载成功 → 用首段作标题 + tags=[导入,docx]', async () => {
      const f = file('doc.docx', 'mock-docx-binary');
      const result = await parseNoteFile(f);
      expect(result.title).toBe('docx text content');
      expect(result.tags).toEqual(['导入', 'docx']);
    });

    it('未知扩展 → 抛错', async () => {
      const f = file('weird.pdf', 'binary');
      await expect(parseNoteFile(f)).rejects.toThrow();
    });
  });

  describe('exportAsMarkdown / exportAsHtml / exportAsJson', () => {
    it('exportAsMarkdown：返回 Blob（markdown 文本）', async () => {
      const blob = exportAsMarkdown('Hello', 'World');
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toContain('markdown');
      const text = await blob.text();
      expect(text).toContain('Hello');
      expect(text).toContain('World');
    });

    it('exportAsHtml：返回 HTML Blob（含 <h1> 或 <p>）', async () => {
      const blob = exportAsHtml('Hello', 'World');
      expect(blob).toBeInstanceOf(Blob);
      const text = await blob.text();
      expect(text).toMatch(/<h1|<p|<html/);
    });

    it('exportAsJson：返回 application/json Blob', () => {
      const blob = exportAsJson({ notes: [], exportedAt: 'x' });
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toContain('json');
    });
  });

  describe('downloadBlob', () => {
    it('触发 a.click() + 1000ms 后 revokeObjectURL', () => {
      vi.useFakeTimers();
      try {
        const blob = new Blob(['test']);
        const createUrl = vi.fn(() => 'blob:mock-url');
        const revokeUrl = vi.fn();
        const origCreate = URL.createObjectURL;
        const origRevoke = URL.revokeObjectURL;
        URL.createObjectURL = createUrl;
        URL.revokeObjectURL = revokeUrl;
        const clickSpy = vi.fn();
        const origCreateEl = document.createElement.bind(document);
        const createElSpy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
          const el = origCreateEl(tag);
          if (tag === 'a') {
            el.click = clickSpy;
          }
          return el;
        });

        downloadBlob(blob, 'test.txt');

        expect(createUrl).toHaveBeenCalledWith(blob);
        expect(clickSpy).toHaveBeenCalled();
        expect(revokeUrl).not.toHaveBeenCalled(); // 还没到 1000ms
        vi.advanceTimersByTime(1000);
        expect(revokeUrl).toHaveBeenCalled();

        URL.createObjectURL = origCreate;
        URL.revokeObjectURL = origRevoke;
        createElSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
