/**
 * Repository 获取工厂（v2.0.0）
 *
 * 根据当前模式返回对应的 DataRepository 实例：
 * - standalone → LocalRepository（Taro.setStorage）
 * - online → RemoteRepository（封装 getApi()）
 *
 * 各业务页面通过 getRepo() 获取数据访问层，无需关心当前模式。
 */

import type { DataRepository } from '@dustnote/shared';
import { useModeStore } from './mode-store';
import { LocalRepository } from './local-repo';
import { RemoteRepository } from './remote-repo';
import { getApi } from '../state/auth';

let cachedRepo: DataRepository | null = null;
let cachedMode: string | null = null;

/**
 * 获取当前模式的 Repository
 *
 * 缓存策略：mode 不变时复用实例，mode 变化时重建。
 */
export function getRepo(): DataRepository {
  const { mode } = useModeStore.getState();
  if (cachedRepo && cachedMode === mode) {
    return cachedRepo;
  }
  if (mode === 'standalone') {
    cachedRepo = new LocalRepository();
  } else {
    cachedRepo = new RemoteRepository(getApi);
  }
  cachedMode = mode;
  return cachedRepo;
}

/**
 * 重置缓存（模式切换后调用）
 */
export function resetRepoCache(): void {
  cachedRepo = null;
  cachedMode = null;
}
