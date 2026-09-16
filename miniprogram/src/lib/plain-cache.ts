/**
 * 解密明文缓存(内存级,页间共享)
 *
 * 背景:mp 各页(index/folders/trash)各自 loadAll + 逐条解密,同一笔记在
 * 页面切换间被重复解密(PBKDF2 时代的解密成本虽然已降,但大库仍明显)。
 * 以「密文原文」为键——密文不变直接命中缓存,变更(任意设备同步)自动失效。
 * 仅存内存,不落盘(与 E2EE 模型一致:明文不进 storage)。
 */

interface CacheEntry {
  ciphertext: string;
  title: string;
  content: string;
  tags?: string[];
}

const cache = new Map<string, CacheEntry>();

/**
 * 条目上限（技术债清理）：此前无上限,大库长时间使用会持续堆积解密后的
 * 明文（每条含完整正文）。Map 保持插入序,超限时淘汰最旧的条目——
 * 命中的条目在 get 时重新插入以维持 LRU 语义。
 */
const MAX_ENTRIES = 300;

export function getCachedPlain(id: string, ciphertext: string): CacheEntry | undefined {
  const hit = cache.get(id);
  if (!hit || hit.ciphertext !== ciphertext) return undefined;
  // LRU：命中的条目移到队尾（Map 迭代序 = 插入序）
  cache.delete(id);
  cache.set(id, hit);
  return hit;
}

export function putCachedPlain(
  id: string,
  ciphertext: string,
  title: string,
  content: string,
  tags?: string[]
): void {
  if (cache.has(id)) cache.delete(id);
  cache.set(id, { ciphertext, title, content, tags });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function invalidatePlain(id: string): void {
  cache.delete(id);
}

export function clearPlainCache(): void {
  cache.clear();
}
