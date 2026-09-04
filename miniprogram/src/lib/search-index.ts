/**
 * 客户端全文搜索(E2EE 友好,移植自 web/src/lib/search.ts)
 *
 * 与 web 的差异:weapp 运行时无 Intl.Segmenter,中文改用**二元组(bigram)分词**
 * ——连续 CJK 串切成交叠双字,查询同样切分后查倒排。二元组对中文检索的
 * 召回/精度接近词级分词,且无需词典。
 *
 * - 内存倒排索引:token → { noteId, field, count }[]
 * - 相关性:标题命中(10) > 标签(5) > 内容(1)
 */

export type Field = 'title' | 'content' | 'tags';

const FIELD_WEIGHT: Record<Field, number> = { title: 10, tags: 5, content: 1 };

interface Posting {
  noteId: string;
  field: Field;
  count: number;
}

export interface SearchHit {
  noteId: string;
  score: number;
  matchedTokens: Set<string>;
}

const CJK_RE = /[\u4e00-\u9fa5\u3400-\u4dbf]/;

/** 切 token:英文按非字母数字切;CJK 连续串按二元组(单字串保留单字) */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  // 按非字母数字(CJK 除外)切段
  const segments = lower.split(/[^a-z0-9\u4e00-\u9fa5\u3400-\u4dbf]+/);
  for (const seg of segments) {
    if (!seg) continue;
    if (!CJK_RE.test(seg)) {
      tokens.push(seg);
      continue;
    }
    // 混合段:把 CJK 连续子串与拉丁子串分别处理
    let buf = '';
    let latin = '';
    const flushLatin = () => {
      if (latin) {
        tokens.push(latin);
        latin = '';
      }
    };
    for (const ch of seg) {
      if (CJK_RE.test(ch)) {
        flushLatin();
        buf += ch;
      } else {
        if (buf) {
          // CJK 串 → 二元组
          if (buf.length === 1) tokens.push(buf);
          else for (let i = 0; i < buf.length - 1; i++) tokens.push(buf.slice(i, i + 2));
          buf = '';
        }
        latin += ch;
      }
    }
    if (buf) {
      if (buf.length === 1) tokens.push(buf);
      else for (let i = 0; i < buf.length - 1; i++) tokens.push(buf.slice(i, i + 2));
    }
    flushLatin();
  }
  return tokens;
}

export class SearchIndex {
  private index = new Map<string, Posting[]>();
  private noteTokens = new Map<string, Set<string>>();

  rebuild(notes: Record<string, { title: string; content: string; tags?: string[] }>): void {
    this.index.clear();
    this.noteTokens.clear();
    for (const [id, plain] of Object.entries(notes)) {
      this.addNote(id, plain);
    }
  }

  update(noteId: string, plain?: { title: string; content: string; tags?: string[] }): void {
    this.remove(noteId);
    if (plain) this.addNote(noteId, plain);
  }

  remove(noteId: string): void {
    const tokens = this.noteTokens.get(noteId);
    if (!tokens) return;
    for (const token of tokens) {
      const postings = this.index.get(token);
      if (!postings) continue;
      const filtered = postings.filter((p) => p.noteId !== noteId);
      if (filtered.length === 0) this.index.delete(token);
      else this.index.set(token, filtered);
    }
    this.noteTokens.delete(noteId);
  }

  private addNote(noteId: string, plain: { title: string; content: string; tags?: string[] }): void {
    const all = new Set<string>();
    this.indexField(noteId, 'title', plain.title, all);
    this.indexField(noteId, 'content', plain.content, all);
    this.indexField(noteId, 'tags', (plain.tags ?? []).join(' '), all);
    this.noteTokens.set(noteId, all);
  }

  private indexField(noteId: string, field: Field, text: string, all: Set<string>): void {
    const counts = new Map<string, number>();
    for (const t of tokenize(text)) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
      all.add(t);
    }
    for (const [token, count] of counts) {
      const existing = this.index.get(token);
      if (existing) existing.push({ noteId, field, count });
      else this.index.set(token, [{ noteId, field, count }]);
    }
  }

  search(query: string, candidateIds?: Set<string>): SearchHit[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
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
    const hits: SearchHit[] = [];
    for (const [noteId, { score, matched }] of scores) {
      hits.push({ noteId, score, matchedTokens: matched });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits;
  }

  clear(): void {
    this.index.clear();
    this.noteTokens.clear();
  }
}
