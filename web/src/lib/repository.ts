/**
 * Web 端 Repository 工厂（v2.0.0）
 *
 * 根据当前 AppMode 返回对应的 DataRepository 实现：
 * - standalone → LocalRepository（IndexedDB）
 * - online → RemoteRepository（封装 ApiClient）
 */

import type { DataRepository, RepositoryFactoryOptions } from '@dustnote/shared';
import { LocalRepository } from './local-repo';
import { RemoteRepository } from './remote-repo';

/**
 * 创建 Repository 实例
 *
 * @param opts 工厂配置
 * @param getAccessToken 获取当前 accessToken 的函数（联机模式必需）
 */
export function createRepository(
  opts: RepositoryFactoryOptions,
  getAccessToken?: () => string | null
): DataRepository {
  if (opts.mode === 'standalone') {
    return new LocalRepository();
  }
  if (!getAccessToken) {
    throw new Error('Online mode requires getAccessToken function');
  }
  return new RemoteRepository(getAccessToken);
}
