/**
 * 安卓端联机模式 DataRepository（平台薄封装）
 *
 * 实现已下沉到 @dustnote/client-core 的 RemoteRepository（审计 ARCH-002：
 * 三端各写一份已漂移——本端此前 emptyTrash 未分页，>500 条回收站会静默漏删）。
 * 这里只保留安卓的平台差异：复用 api.ts 的单例（baseUrl / deviceId / token
 * 由该单例的拦截器按 mode-store 动态注入）。
 */

import { RemoteRepository as CoreRemoteRepository } from '@dustnote/client-core';
import { api } from '../api';
import { APP_VERSION } from './version';

export class RemoteRepository extends CoreRemoteRepository {
  constructor() {
    super(() => api, { appVersion: APP_VERSION });
  }
}

/** 服务端响应类型再导出（屏幕层曾从本模块取用） */
export type { NoteRow, Folder, Tag, Preferences, Ciphertext } from '@dustnote/shared';
