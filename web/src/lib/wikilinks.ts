/**
 * 双向链接（Wikilinks）支持
 *
 * 解析 `[[笔记标题]]` 语法，生成可点击的笔记内链接。
 * 配合 backlink index 实现反向链接面板。
 */

import type { TokenizerAndRendererExtension } from 'marked';

/**
 * 自定义 marked extension：解析 [[note-title]] 为可点击链接
 *
 * 语法：`[[笔记标题]]` 或 `[[笔记标题|显示文本]]`
 * 渲染为：`<a class="wikilink" data-note-title="笔记标题">显示文本</a>`
 */
export const wikilinkExtension: TokenizerAndRendererExtension = {
  name: 'wikilink',
  level: 'inline',
  start(src: string) {
    return src.match(/\[\[/)?.index;
  },
  tokenizer(src: string) {
    const match = src.match(/^\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/);
    if (match) {
      return {
        type: 'wikilink',
        raw: match[0],
        title: match[1]!.trim(),
        text: (match[2] ?? match[1]!).trim(),
      };
    }
    return undefined;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderer(token: any) {
    const title = String(token.title ?? '');
    const text = String(token.text ?? '');
    const escapedTitle = title
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const escapedText = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<a class="wikilink text-mint-600 dark:text-mint-400 hover:underline cursor-pointer" data-note-title="${escapedTitle}">${escapedText}</a>`;
  },
};

/**
 * 从笔记内容中提取所有 wikilink 目标标题
 */
export function extractWikilinks(content: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const title = match[1]!.trim();
    if (title && !links.includes(title)) {
      links.push(title);
    }
  }
  return links;
}

/**
 * 构建反向链接索引：给定所有笔记的 title→id 映射和每条笔记的 wikilinks，
 * 返回 targetTitle → [{ sourceId, sourceTitle }] 映射。
 */
export function buildBacklinkIndex(
  notes: Map<string, { id: string; title: string; links: string[] }>
): Map<string, { sourceId: string; sourceTitle: string }[]> {
  const index = new Map<string, { sourceId: string; sourceTitle: string }[]>();
  for (const note of notes.values()) {
    for (const targetTitle of note.links) {
      const existing = index.get(targetTitle) ?? [];
      existing.push({ sourceId: note.id, sourceTitle: note.title });
      index.set(targetTitle, existing);
    }
  }
  return index;
}
