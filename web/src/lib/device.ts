/**
 * 设备 ID 持久化（web 端）
 * - 委托 @dustnote/client-core 的统一实现（get-or-generate UUIDv4）
 * - 注入 localStorage 适配器；行为与其余端一致
 * - 用于 update-manifest 灰度流量切分 / 按设备撤销
 */
import { createDeviceIdStore, randomUuid } from '@dustnote/client-core';

export { randomUuid };

const store = createDeviceIdStore({
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* 隐私模式/配额满时忽略 */
    }
  },
});

export function getDeviceId(): string {
  return store();
}
