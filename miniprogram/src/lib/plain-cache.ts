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

export function getCachedPlain(id: string, ciphertext: string): CacheEntry | undefined {
  const hit = cache.get(id);
  return hit && hit.ciphertext === ciphertext ? hit : undefined;
}

export function putCachedPlain(
  id: string,
  ciphertext: string,
  title: string,
  content: string,
  tags?: string[],
): void {
  cache.set(id, { ciphertext, title, content, tags });
}

export function invalidatePlain(id: string): void {
  cache.delete(id);
}

export function clearPlainCache(): void {
  cache.clear();
}
