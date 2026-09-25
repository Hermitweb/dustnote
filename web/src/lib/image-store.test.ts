/**
 * image-store 纯函数单测（P0-3 图片止血，2026-09-25）
 *
 * restoreNoteImages/storeImage 触达 IndexedDB，属集成面；
 * replaceMissingImageRefs 是渲染占位的核心纯函数，在这里锁定契约：
 * - 未还原的 dustnote-img:// 引用 → 占位 data URL
 * - 已还原（data: URL）与外链（http）不动
 * - alt 文本保留（无 alt 给"图片"）
 */
import { describe, expect, it } from 'vitest';
import { replaceMissingImageRefs, MISSING_IMAGE_PLACEHOLDER } from './image-store';

describe('replaceMissingImageRefs', () => {
  it('残留的本地引用替换为占位，alt 保留', () => {
    const out = replaceMissingImageRefs('前言\n![我的猫](dustnote-img://abc123)\n后语');
    expect(out).toContain('![我的猫](');
    expect(out).toContain(MISSING_IMAGE_PLACEHOLDER.slice(0, 30));
    expect(out).not.toContain('dustnote-img://');
    expect(out).toContain('前言');
    expect(out).toContain('后语');
  });

  it('空 alt 给默认文案', () => {
    const out = replaceMissingImageRefs('![](dustnote-img://x1)');
    expect(out).toContain('![图片](');
  });

  it('已还原的 data URL 与 http(s) 外链原样保留', () => {
    const src =
      '![a](data:image/jpeg;base64,AAAA)\n![b](https://example.com/i.png)\n![c](dustnote-img://z9)';
    const out = replaceMissingImageRefs(src);
    expect(out).toContain('![a](data:image/jpeg;base64,AAAA)');
    expect(out).toContain('![b](https://example.com/i.png)');
    expect(out).not.toContain('dustnote-img://z9');
  });

  it('多图全部替换且互不吞并', () => {
    const src = '![1](dustnote-img://aa) x ![2](dustnote-img://bb)';
    const out = replaceMissingImageRefs(src);
    expect(out.match(/data:image\/svg\+xml/g)?.length).toBe(2);
  });

  it('占位符是合法 data URL（可直接进 img src）', () => {
    expect(MISSING_IMAGE_PLACEHOLDER.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    const svg = decodeURIComponent(MISSING_IMAGE_PLACEHOLDER.split(',', 2)[1] ?? '');
    expect(svg).toContain('<svg');
    expect(svg).toContain('图片未同步到本设备');
  });
});
