/**
 * Editor 组件测试
 *
 * 验证核心编辑功能：创建、编辑、wikilink、斜杠命令
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('idb-keyval', () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => undefined),
  del: vi.fn(async () => undefined),
}));

describe('wikilinks', () => {
  it('extractWikilinks 提取链接标题', async () => {
    const { extractWikilinks } = await import('../lib/wikilinks');
    expect(extractWikilinks('Hello [[World]] and [[Test|display]]')).toEqual(['World', 'Test']);
    expect(extractWikilinks('No links here')).toEqual([]);
    expect(extractWikilinks('[[a]] [[a]] [[b]]')).toEqual(['a', 'b']);
  });

  it('buildBacklinkIndex 构建反向索引', async () => {
    const { buildBacklinkIndex } = await import('../lib/wikilinks');
    const notes = new Map([
      ['1', { id: '1', title: 'Note A', links: ['Note B', 'Note C'] }],
      ['2', { id: '2', title: 'Note B', links: ['Note C'] }],
      ['3', { id: '3', title: 'Note C', links: [] }],
    ]);
    const index = buildBacklinkIndex(notes);
    expect(index.get('Note B')).toEqual([{ sourceId: '1', sourceTitle: 'Note A' }]);
    expect(index.get('Note C')).toEqual([
      { sourceId: '1', sourceTitle: 'Note A' },
      { sourceId: '2', sourceTitle: 'Note B' },
    ]);
    expect(index.get('Note A')).toBeUndefined();
  });
});

describe('slash-commands', () => {
  it('filterSlashCommands 过滤命令', async () => {
    const { filterSlashCommands } = await import('../lib/slash-commands');
    const all = filterSlashCommands('');
    expect(all.length).toBeGreaterThan(5);

    const date = filterSlashCommands('date');
    expect(date.some((c) => c.id === 'date')).toBe(true);

    const empty = filterSlashCommands('nonexistent');
    expect(empty).toHaveLength(0);
  });

  it('resolveSlashCommand 替换占位符', async () => {
    const { resolveSlashCommand } = await import('../lib/slash-commands');
    const result = resolveSlashCommand('{{date}} {{time}}');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe('image-store', () => {
  it('countBase64Images 统计图片数量', async () => {
    const { countBase64Images } = await import('../lib/image-store');
    expect(countBase64Images('![img](data:image/png;base64,abc123)')).toBe(1);
    expect(countBase64Images('no images')).toBe(0);
    expect(countBase64Images(
      '![a](data:image/png;base64,abc) ![b](data:image/jpeg;base64,def)'
    )).toBe(2);
  });
});
