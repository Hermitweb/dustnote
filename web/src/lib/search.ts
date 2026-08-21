/**
 * 客户端全文搜索 v2（E2EE 友好）
 *
 * 设计要点：
 * - E2EE 下服务端无法检索密文，搜索必须在客户端对解密后的明文进行
 * - 使用 Intl.Segmenter 做中文分词（粒度 word），同时支持英文按空格/标点切分
 * - 内存倒排索引：token → { noteId, field, count }[]
 * - 相关性排序：标题命中权重 > 内容命中 > 标签命中；命中次数越多权重越高
 * - 支持高亮：返回每个笔记的匹配 token 集合，UI 据此 wrap <mark>
 *
 * 性能：
 * - 索引构建 O(n)，n = 所有笔记的 token 总数
 * - 查询 O(k + m)，k = 查询词 token 数，m = 命中文档数
 * - 增量更新：笔记变更时只重新索引单条，无需全量重建
 */

import type { NotePlaintext } from './store';

/** 字段权重：标题命中比内容命中更重要 */
const FIELD_WEIGHT = {
  title: 10,
  content: 1,
  tags: 5,
} as const;

type Field = keyof typeof FIELD_WEIGHT;

interface Posting {
  noteId: string;
  field: Field;
  /** 该 token 在此字段出现的次数 */
  count: number;
}

export interface SearchHit {
  noteId: string;
  /** 总相关性得分（越大越相关） */
  score: number;
  /** 命中的 token 集合（用于 UI 高亮） */
  matchedTokens: Set<string>;
}

/** 中文分词器（word 粒度）。Intl.Segmenter 在现代浏览器和 Node 16+ 可用。 */
let segmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter | null {
  if (segmenter) return segmenter;
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter !== 'undefined') {
    segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
    return segmenter;
  }
  // 降级：无 Intl.Segmenter 时返回 null，调用方走空格切分
  return null;
}

/**
 * 把文本切成 token（小写化）。
 *
 * - 有 Intl.Segmenter：中文按词切分，英文按词切分，过滤纯标点/空白
 * - 无 Intl.Segmenter：按空格和常见标点切分（英文友好，中文退化为单字）
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const seg = getSegmenter();
  if (seg) {
    const tokens: string[] = [];
    for (const { segment, isWordLike } of seg.segment(lower)) {
      if (!isWordLike) continue;
      const t = segment.trim();
      if (t.length === 0) continue;
      tokens.push(t);
    }
    return tokens;
  }
  // 降级：按非字母数字切分
  return lower.split(/[^a-z0-9\u4e00-\u9fa5]+/).filter((t) => t.length > 0);
}

/**
 * 客户端内存倒排索引。
 *
 * 使用方式：
 *   const idx = new SearchIndex();
 *   idx.rebuild(notesPlain);           // 全量构建
 *   idx.update(noteId, plain);          // 增量更新单条
 *   idx.remove(noteId);                 // 删除单条
 *   const hits = idx.search('query');   // 查询
 */
export class SearchIndex {
  /** token → Posting 列表 */
  private index = new Map<string, Posting[]>();
  /** noteId → 该笔记的所有 token（用于增量更新时清理旧索引） */
  private noteTokens = new Map<string, Set<string>>();

  /** 全量重建索引 */
  rebuild(notes: Map<string, NotePlaintext>): void {
    this.index.clear();
    this.noteTokens.clear();
    for (const [id, plain] of notes) {
      this.addNote(id, plain);
    }
  }

  /** 增量更新单条笔记（变更或新增） */
  update(noteId: string, plain: NotePlaintext | undefined): void {
    this.remove(noteId);
    if (plain) this.addNote(noteId, plain);
  }

  /** 删除单条笔记的索引 */
  remove(noteId: string): void {
    const tokens = this.noteTokens.get(noteId);
    if (!tokens) return;
    for (const token of tokens) {
      const postings = this.index.get(token);
      if (!postings) continue;
      const filtered = postings.filter((p) => p.noteId !== noteId);
      if (filtered.length === 0) {
        this.index.delete(token);
      } else {
        this.index.set(token, filtered);
      }
    }
    this.noteTokens.delete(noteId);
  }

  private addNote(noteId: string, plain: NotePlaintext): void {
    const allTokens = new Set<string>();
    this.indexField(noteId, 'title', plain.title, allTokens);
    this.indexField(noteId, 'content', plain.content, allTokens);
    this.indexField(noteId, 'tags', plain.tags.join(' '), allTokens);
    this.noteTokens.set(noteId, allTokens);
  }

  private indexField(noteId: string, field: Field, text: string, allTokens: Set<string>): void {
    const tokens = tokenize(text);
    // 统计每个 token 在此字段的出现次数
    const counts = new Map<string, number>();
    for (const t of tokens) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
      allTokens.add(t);
    }
    for (const [token, count] of counts) {
      const posting: Posting = { noteId, field, count };
      const existing = this.index.get(token);
      if (existing) {
        existing.push(posting);
      } else {
        this.index.set(token, [posting]);
      }
    }
  }

  /**
   * 搜索：对查询词分词后查倒排索引，按相关性排序。
   *
   * @param query 原始查询字符串
   * @param candidateIds 可选，限定搜索范围（如只在当前文件夹内搜）
   * @returns 按得分降序排列的命中列表
   */
  search(query: string, candidateIds?: Set<string>): SearchHit[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    // 短查询降级：单字符 token 在中文里意义不大（如"的"），但英文单字符可能有用
    // 这里保留所有 token，但短 token（length===1 且非 ASCII）权重自然较低

    const scores = new Map<string, { score: number; matched: Set<string> }>();

    for (const qt of queryTokens) {
      const postings = this.index.get(qt);
      if (!postings) continue;
      for (const p of postings) {
        if (candidateIds && !candidateIds.has(p.noteId)) continue;
        const weight = FIELD_WEIGHT[p.field] * p.count;
        const entry = scores.get(p.noteId);
        if (entry) {
          entry.score += weight;
          entry.matched.add(qt);
        } else {
          scores.set(p.noteId, { score: weight, matched: new Set([qt]) });
        }
      }
    }

    // 转为数组并排序（得分降序）
    const hits: SearchHit[] = [];
    for (const [noteId, { score, matched }] of scores) {
      hits.push({ noteId, score, matchedTokens: matched });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits;
  }

  /** 清空索引 */
  clear(): void {
    this.index.clear();
    this.noteTokens.clear();
  }
}

/**
 * 把文本中的匹配 token 用 <mark> 包裹（用于高亮渲染）。
 *
 * 注意：返回的 HTML 片段需经过 sanitizeHtml 才能安全 dangerouslySetInnerHTML。
 * 这里只做 token 级别的简单替换，不引入 XSS（token 已经过 tokenize 过滤）。
 *
 * @param text 原始文本
 * @param matchedTokens 匹配的 token 集合
 * @returns 带 <mark> 标记的 HTML 字符串
 */
export function highlightMatches(text: string, matchedTokens: Set<string>): string {
  if (matchedTokens.size === 0) return text;
  // 转义 HTML 特殊字符，防止 XSS
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // 把所有 token 按长度降序排列，优先匹配长 token（避免短 token 子串干扰）
  const tokens = Array.from(matchedTokens).sort((a, b) => b.length - a.length);
  if (tokens.length === 0) return escaped;

  // 构造正则：token 之间用 | 连接，转义正则特殊字符
  const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(${pattern})`, 'gi');
  return escaped.replace(re, '<mark>$1</mark>');
}
