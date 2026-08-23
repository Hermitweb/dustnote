/**
 * 设备 ID 持久化
 * - 首次访问生成 UUID v4
 * - localStorage 存储
 * - 用于 update-manifest 灰度流量切分
 */

const KEY = 'dustnote_device_id';

/**
 * 生成 UUID v4。
 * 不用 crypto.randomUUID：它只在安全上下文（HTTPS / localhost）存在，
 * 用户经 http://<公网IP> 访问时会直接 TypeError。
 * crypto.getRandomValues 在非安全上下文同样可用，故基于它实现，并回退 Math.random。
 */
export function randomUuid(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getDeviceId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = randomUuid();
    localStorage.setItem(KEY, id);
  }
  return id;
}
