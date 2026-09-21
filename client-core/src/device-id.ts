/**
 * 跨端设备 ID（审计 ARCH-R03）：统一 getDeviceId 的生成/持久化语义，消除四端漂移。
 *
 * 之前四端各写一份：web 用 getRandomValues UUID、desktop 用 crypto.randomUUID(无回退)、
 * mobile 用 Date.now+Math.random(非 UUID)、miniprogram 只读不写缺省返回空串(破坏按设备撤销)。
 * 现统一到本模块：注入各端存储适配器，get-or-generate + 持久化 + 标准 UUIDv4。
 */

export const DEVICE_ID_KEY = 'dustnote_device_id';

/** 存储适配器（各端注入 localStorage / AsyncStorage / Taro storage 等） */
export interface DeviceIdStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/**
 * 生成 UUID v4。不用 crypto.randomUUID（仅安全上下文存在，http 直连会抛错）；
 * 基于 crypto.getRandomValues，缺失时回退 Math.random（保证不崩，仍产 UUID 形状）。
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

/**
 * 创建一个同步 getDeviceId：命中存储则返回，否则生成 UUIDv4 并持久化。
 * 各端只需注入自己的存储适配器，行为完全一致（含"缺失即生成并落库"）。
 */
export function createDeviceIdStore(storage: DeviceIdStorage): () => string {
  return () => {
    const existing = storage.get(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = randomUuid();
    try {
      storage.set(DEVICE_ID_KEY, id);
    } catch {
      /* 存储不可用时仍返回本次生成的 id（不阻断） */
    }
    return id;
  };
}
