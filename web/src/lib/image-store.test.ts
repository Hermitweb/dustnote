/**
 * web/src/lib/image-store.test.ts - 图片存储优化（纯函数 + IndexedDB 集成）
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { installPolyfills } from '../test/polyfills';

installPolyfills();

import { replaceMissingImageRefs, MISSING_IMAGE_PLACEHOLDER } from './image-store';

afterEach(() => {
  vi.clearAllMocks();
});

describe('image-store 纯函数', () => {
  describe('replaceMissingImageRefs', () => {
    it('无引用 → 原样返回', () => {
      expect(replaceMissingImageRefs('hello world')).toBe('hello world');
      expect(replaceMissingImageRefs('')).toBe('');
    });

    it('单个 dustnote-img:// 引用 → 占位图', () => {
      const input = 'before ![alt](dustnote-img://abc123) after';
      const out = replaceMissingImageRefs(input);
      expect(out).toContain('![');
      expect(out).toContain('](data:image/svg+xml');
      expect(out).not.toContain('dustnote-img://');
    });

    it('多个引用全部替换', () => {
      const input = '![a](dustnote-img://x1) text ![b](dustnote-img://x2)';
      const out = replaceMissingImageRefs(input);
      expect(out).not.toContain('dustnote-img://');
      // 两个 ![ 都保留（占位图本身也是 data URL）
      expect((out.match(/!/g) || []).length).toBe(2);
    });

    it('空 alt 名 → 用 "图片" 兜底', () => {
      const input = '![](dustnote-img://abc)';
      const out = replaceMissingImageRefs(input);
      expect(out).toContain('![图片]');
    });

    it('非 dustnote-img:// 链接保留（如 https://...）', () => {
      const input = '![x](https://example.com/a.png)';
      expect(replaceMissingImageRefs(input)).toBe(input);
    });

    it('MISSING_IMAGE_PLACEHOLDER 是合法 SVG data URL', () => {
      expect(MISSING_IMAGE_PLACEHOLDER.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
      // URL-encoded，解码后断言
      const decoded = decodeURIComponent(MISSING_IMAGE_PLACEHOLDER.split(',')[1]!);
      expect(decoded).toContain('Image not synced');
      expect(decoded).toContain('图片未同步');
    });
  });

  describe('generateImageId（内部但通过 storeImage 间接测试）', () => {
    it('storeImage 返回非空 ID', async () => {
      // 用 fake-indexeddb 已自动 polyfill 到 globalThis.indexedDB
      const id = await import('./image-store').then((m) =>
        m.storeImage('data:image/png;base64,abc')
      );
      expect(id).toBeTruthy();
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe('IndexedDB CRUD 集成', () => {
    it('storeImage → getImage → 返回原 blob', async () => {
      const { storeImage, getImage } = await import('./image-store');
      const blob = 'data:image/png;base64,iVBORw0KGgo';
      const id = await storeImage(blob);
      const out = await getImage(id);
      expect(out).toBe(blob);
    });

    it('getImage 不存在 → 返回 null', async () => {
      const { getImage } = await import('./image-store');
      const out = await getImage('nonexistent-id-xxx');
      expect(out).toBeNull();
    });

    it('deleteImage → 后续 getImage 返回 null', async () => {
      const { storeImage, getImage, deleteImage } = await import('./image-store');
      const id = await storeImage('data:image/png;base64,zzz');
      expect(await getImage(id)).toBeTruthy();
      await deleteImage(id);
      expect(await getImage(id)).toBeNull();
    });
  });
});
