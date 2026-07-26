/**
 * 单机模式会话管理（v2.0.0）
 *
 * 小程序页面之间不共享 React 状态，masterKey 需通过 Taro.eventCenter 传递。
 * 此模块作为 masterKey 的全局持有者：
 * - 模块加载时订阅 `standalone:masterKey` 事件
 * - standalone-setup/unlock/recover 页面在解封后发布事件
 * - 各业务页面通过 getStandaloneMasterKey() 读取
 *
 * 注意：masterKey 仅存内存，小程序进程退出后丢失，需重新解锁。
 */

import Taro from '@tarojs/taro';
import { fromBase64, toBase64 } from '@dustnote/shared';

const EVENT_MASTER_KEY = 'standalone:masterKey';

let cachedMasterKey: Uint8Array | null = null;

/** 将 masterKey 发布给所有页面（base64 编码，避免事件序列化问题） */
export function publishMasterKey(masterKey: Uint8Array): void {
  cachedMasterKey = masterKey;
  Taro.eventCenter.trigger(EVENT_MASTER_KEY, toBase64(masterKey));
}

/** 读取缓存的 masterKey（仅在解锁后有效） */
export function getStandaloneMasterKey(): Uint8Array | null {
  return cachedMasterKey;
}

/** 设置 masterKey（不发布事件，仅用于内部同步） */
export function setStandaloneMasterKey(key: Uint8Array | null): void {
  cachedMasterKey = key;
}

/** 清空 masterKey（锁定 / 注销时调用） */
export function clearStandaloneMasterKey(): void {
  if (cachedMasterKey) {
    cachedMasterKey.fill(0);
  }
  cachedMasterKey = null;
}

/**
 * 订阅 masterKey 变化事件
 *
 * 在页面加载时调用，确保页面切换后也能收到事件。
 * 返回取消订阅的函数。
 */
export function subscribeMasterKey(cb: (key: Uint8Array) => void): () => void {
  const handler = (b64: string) => {
    try {
      cachedMasterKey = fromBase64(b64);
      cb(cachedMasterKey);
    } catch {
      /* base64 解码失败，忽略 */
    }
  };
  Taro.eventCenter.on(EVENT_MASTER_KEY, handler);
  return () => {
    Taro.eventCenter.off(EVENT_MASTER_KEY, handler);
  };
}

/**
 * 初始化：订阅全局事件
 *
 * 在 app.tsx 的 useLaunch 中调用一次即可。
 * 若 cachedMasterKey 已有值（同一进程内的页面跳转），回调会被立即触发。
 */
export function initStandaloneSession(): void {
  Taro.eventCenter.on(EVENT_MASTER_KEY, (b64: string) => {
    try {
      cachedMasterKey = fromBase64(b64);
    } catch {
      /* ignore */
    }
  });
}
