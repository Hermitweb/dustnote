/**
 * 小程序联机模式 DataRepository（平台薄封装）
 *
 * 实现已下沉到 @dustnote/client-core 的 RemoteRepository（审计 ARCH-002：
 * 三端各写一份已漂移）。本端原本就是「注入 getApi」的形态，是下沉的蓝本；
 * 现在只保留平台差异：getApi 来自 state/auth.ts（内部读 mode-store 的
 * serverUrl 与最新 accessToken），版本号用 APP_VERSION 常量。
 */

import type { ApiClient } from '@dustnote/shared';
import { RemoteRepository as CoreRemoteRepository } from '@dustnote/client-core';
import { APP_VERSION } from '../state/auth';

export class RemoteRepository extends CoreRemoteRepository {
  /**
   * @param getApi 返回最新 ApiClient 实例的函数（通常绑定 state/auth.ts 的
   *   getApi()，该函数内部读取 useAuthStore.getState().accessToken）
   */
  constructor(getApi: () => ApiClient) {
    super(getApi, { appVersion: APP_VERSION });
  }
}
