/**
 * Repository 工厂（v2.0.0 单机/联机双模式）
 *
 * 根据 mode 返回 local-repo 或 remote-repo：
 * - standalone → LocalRepository（AsyncStorage 后端）
 * - online     → RemoteRepository（封装 api 单例，baseUrl 由 mode-store 动态解析）
 *
 * 工厂签名对齐 shared/src/repository.ts 的 RepositoryFactory。
 *
 * 使用示例：
 * ```ts
 * import { createRepository } from '@/lib/repository';
 * import { useModeStore } from '@/lib/mode-store';
 *
 * const { mode, serverUrl } = useModeStore.getState();
 * const repo = createRepository({
 *   mode,
 *   serverUrl,
 *   accessToken: authToken,
 *   deviceId,
 * });
 * const snapshot = await repo.loadAll();
 * ```
 *
 * 注意：remote-repo 复用 api.ts 的 api 单例，baseUrl 在每次请求时从 mode-store
 * 动态解析，故工厂参数中的 serverUrl / accessToken / deviceId 仅用于未来扩展
 * （例如多实例 ApiClient），当前实现不直接使用。
 */

import type {
  DataRepository,
  RepositoryFactoryOptions,
} from '@dustnote/shared';
import { LocalRepository } from './local-repo';
import { RemoteRepository } from './remote-repo';

/**
 * 根据当前模式创建对应的 DataRepository
 *
 * @param opts.mode         当前应用模式（standalone / online）
 * @param opts.serverUrl    联机模式服务器 URL（保留参数，由 mode-store 解析）
 * @param opts.accessToken  访问令牌（保留参数，由 api 单例注入）
 * @param opts.deviceId     设备 ID（保留参数，由 api 单例注入）
 */
export function createRepository(opts: RepositoryFactoryOptions): DataRepository {
  if (opts.mode === 'standalone') {
    return new LocalRepository();
  }
  return new RemoteRepository();
}
