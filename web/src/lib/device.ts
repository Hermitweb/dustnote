/**
 * 设备 ID 持久化
 * - 首次访问生成 UUID v4
 * - localStorage 存储
 * - 用于 update-manifest 灰度流量切分
 */

const KEY = 'dustnote_device_id';

function uuidv4(): string {
  // 简单实现（生产建议用 crypto.randomUUID）
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getDeviceId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = uuidv4();
    localStorage.setItem(KEY, id);
  }
  return id;
}
