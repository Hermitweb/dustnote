/**
 * web/src/lib/image-paste.ts 单测 —— 图片压缩 / data URL 转换
 *
 * jsdom 没有真实的 canvas/image 解码。测试用 happy-dom-like 替代：
 * - stub HTMLImageElement 走 onload 直接回调（跳过真实解码）
 * - stub canvas.getContext('2d') 返回一个最小的 ctx（drawImage/getImageData/toDataURL）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isImageFile,
  fileToImageDataUrl,
  buildMarkdownImage,
  insertAtCursor,
} from './image-paste.js';

/** 构造一个 File（jsdom 里有 File 构造函数）。 */
function makeFile(name: string, type: string): File {
  return new File([new Uint8Array(8)], name, { type });
}

function makeTextarea(value: string, start: number, end: number): HTMLTextAreaElement {
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.selectionStart = start;
  ta.selectionEnd = end;
  return ta;
}

describe('image-paste', () => {
  describe('isImageFile', () => {
    it.each([
      ['image/png', true],
      ['image/jpeg', true],
      ['image/gif', true],
      ['image/webp', true],
      ['text/plain', false],
      ['application/json', false],
    ])('type=%s → %s', (type, expected) => {
      expect(isImageFile(makeFile('a', type))).toBe(expected);
    });
  });

  describe('buildMarkdownImage', () => {
    it('产出标准 Markdown 图片语法', () => {
      expect(buildMarkdownImage('data:image/png;base64,ABC', 'cat')).toBe(
        '![cat](data:image/png;base64,ABC)'
      );
    });

    it('alt 内的特殊字符按原样保留（调用方负责转义）', () => {
      expect(buildMarkdownImage('x', 'a]b')).toBe('![a]b](x)');
    });
  });

  describe('insertAtCursor', () => {
    it('光标在中间（前后都有非空非换行文本）→ 前后各补 \\n\\n', () => {
      const ta = makeTextarea('hello world', 5, 5);
      const out = insertAtCursor(ta, 'X');
      // before='hello' (不以 \n 结尾) + after=' world' (不以 \n 起)
      expect(out.value).toBe('hello\n\nX\n\n world');
      // cursor = 5 + '\n\nX\n\n'.length(5) = 10
      expect(out.selectionStart).toBe(10);
    });

    it('光标在文本开头（前面空）→ 不补前缀，但后缀文本需补 \\n\\n', () => {
      const ta = makeTextarea('abc', 0, 0);
      const out = insertAtCursor(ta, 'X');
      // before='' 不补，after='abc' 不以 \n 起 → suffix='\n\n'
      expect(out.value).toBe('X\n\nabc');
    });

    it('光标在文本末尾（后面空）→ 不补后缀，但前面文本需补 \\n\\n', () => {
      const ta = makeTextarea('abc', 3, 3);
      const out = insertAtCursor(ta, 'X');
      // before='abc' 不以 \n 结尾 → prefix='\n\n'，after='' 不补
      expect(out.value).toBe('abc\n\nX');
    });

    it('光标前后已经是换行 → 不重复补 \\n\\n', () => {
      const ta = makeTextarea('a\n\nb', 2, 2); // 在换行后
      const out = insertAtCursor(ta, 'X');
      // before='a\n' 以 \n 结尾 → 不补；after='\nb' 以 \n 起 → 不补
      expect(out.value).toBe('a\nX\nb');
    });

    it('选中替换：start<end → 用选中段替换', () => {
      const ta = makeTextarea('hello world', 5, 11); // 选中 " world"
      const out = insertAtCursor(ta, 'X');
      // before='hello' 不以 \n → prefix='\n\n'，after='' 不补
      expect(out.value).toBe('hello\n\nX');
    });

    it('selectionStart/End 为 null → 视作末尾', () => {
      const ta = makeTextarea('abc', 0, 0) as HTMLTextAreaElement;
      Object.defineProperty(ta, 'selectionStart', { value: null, configurable: true });
      Object.defineProperty(ta, 'selectionEnd', { value: null, configurable: true });
      const out = insertAtCursor(ta, 'X');
      // start=end=value.length=3 → 插入到末尾，before='abc' → prefix='\n\n'
      expect(out.value).toBe('abc\n\nX');
    });
  });

  describe('fileToImageDataUrl', () => {
    /** 模拟 canvas + image：toDataURL 返回预设值，drawImage 不报错。
     *  注意 image-paste 调用的是 `canvas.toDataURL(...)`（非 ctx.toDataURL），
     *  所以 toDataURL 必须挂在 canvas 上。 */
    function installFakeCanvas(dataUrl: string) {
      const drawImage = vi.fn();
      const getImageData = vi.fn(() => ({
        // 全部 alpha=255 → opaque=true → keepAlpha=false
        data: new Uint8Array(4 * 4).fill(255).map((v, i) => (i % 4 === 3 ? v : 0)),
      }));
      const toDataURL = vi.fn(() => dataUrl);
      const ctx = { drawImage, getImageData };
      const getContext = vi.fn(() => ctx);
      const fakeCanvas = {
        width: 0,
        height: 0,
        getContext,
        toDataURL,
      };
      const origCreate = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'canvas') return fakeCanvas as unknown as HTMLCanvasElement;
        return origCreate(tag);
      });
      return { drawImage, getImageData, toDataURL, getContext };
    }

    /** jsdom 默认不实现 URL.createObjectURL；polyfill 让 fileToImageDataUrl 走通。
     *  替换 globalThis.Image 为一个最小 stub，set src 立即同步 fire onload，
     *  跳过真实图片解码。 */
    function installFakeImage() {
      if (!('createObjectURL' in URL)) {
        Object.defineProperty(URL, 'createObjectURL', {
          value: () => 'blob:fake',
          configurable: true,
          writable: true,
        });
        Object.defineProperty(URL, 'revokeObjectURL', {
          value: () => undefined,
          configurable: true,
          writable: true,
        });
      }
      const FakeImage: typeof Image = class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        width = 100;
        height = 100;
        set src(_v: string) {
          // microtask 异步触发 onload，模拟真实异步解码
          queueMicrotask(() => this.onload?.());
        }
      } as unknown as typeof Image;
      globalThis.Image = FakeImage;
    }

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('非图片文件 → 抛 "非图片文件"', async () => {
      installFakeImage();
      installFakeCanvas('data:image/png;base64,XX');
      const f = makeFile('a.txt', 'text/plain');
      await expect(fileToImageDataUrl(f)).rejects.toThrow(/非图片文件/);
    });

    it('图片 → 返回 dataUrl + alt（去扩展名）', async () => {
      installFakeImage();
      installFakeCanvas('data:image/jpeg;base64,/9j/AAA');
      const f = makeFile('cat.png', 'image/png');
      const out = await fileToImageDataUrl(f);
      expect(out.dataUrl).toBe('data:image/jpeg;base64,/9j/AAA');
      expect(out.alt).toBe('cat');
    });

    it('alt 缺省 → "image"（防止空 alt）', async () => {
      installFakeImage();
      installFakeCanvas('data:image/jpeg;base64,X');
      // 用 .png 后缀，strip 后变空 → 兜底 "image"
      const f = makeFile('.png', 'image/png');
      const out = await fileToImageDataUrl(f);
      expect(out.alt).toBe('image');
    });
  });
});
