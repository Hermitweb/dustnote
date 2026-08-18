/**
 * 小程序端 Repository 工厂（v2.0.0）
 *
 * 根据当前 AppMode 返回对应的 DataRepository 实现：
 * - standalone → LocalRepository（Taro.setStorage）
 * - online → RemoteRepository（封装 ApiClient）
 *
 * 设计说明：
 * - 工厂不持有状态，每次调用都返回新实例（依赖通过参数注入）
 * - 联机模式的 accessToken 由 state/auth.ts 的 useAuthStore 持有，
 *   通过 getApi 函数注入（每次调用读取最新 token）
 */

import type { ApiClient, DataRepository, RepositoryFactoryOptions } from '@dustnote/shared';
import { LocalRepository } from './local-repo';
import { RemoteRepository } from './remote-repo';

/**
 * 创建 Repository 实例
 *
 * @param opts 工厂配置（包含 mode / serverUrl / accessToken / deviceId）
 * @param getApi 联机模式必需：返回当前 ApiClient 的函数
 *   （通常绑定到 state/auth.ts 的 getApi()，该函数内部读取 mode-store 的 serverUrl
 *    和 useAuthStore.getState().accessToken）
 */
export function createRepository(
  opts: RepositoryFactoryOptions,
  getApi?: () => ApiClient
): DataRepository {
  if (opts.mode === 'standalone') {
    return new LocalRepository();
  }
  if (!getApi) {
    throw new Error('Online mode requires getApi function');
  }
  return new RemoteRepository(getApi);
}
