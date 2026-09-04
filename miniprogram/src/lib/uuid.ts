/**
 * UUID v4 生成(与 web/src/lib/device.ts 的 randomUuid 语义一致)。
 * 不依赖 crypto.randomUUID(HTTPS-only);走 crypto.getRandomValues——
 * weapp 下由 crypto-polyfill 提供池化实现。无安全源时直接抛错,
 * 绝不降级到 Math.random(加密用途禁止可预测 id)。
 */
export function randomUuid(): string {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  if (!g.crypto || typeof g.crypto.getRandomValues !== 'function') {
    throw new Error('无安全随机源,无法生成 UUID');
  }
  const bytes = new Uint8Array(16);
  g.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
