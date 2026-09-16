/**
 * 部署预置配置（发布包构建期决定）
 *
 * DEPLOY_DEFAULT_SERVER_URL 是**引导地址**：新设备首启先到它拉取服务端
 * 登记的规范地址（GET /config/server-endpoint,首次激活的设备 POST 登记的），
 * 拉到就直接以联机模式落库进解锁/初始化流程——新机免「选模式 + 输地址」；
 * 引导地址不可达 → 展示地址失效提示（手动输入或去设置改），下次启动重试。
 * 开发构建保持空串即可走完整的选择流程。
 *
 * 只自动应用一次（APPLIED_KEY 标记）：用户之后从设置页「切换模式」回到
 * 选择页时仍可自由选单机，不会被每次启动强拉回联机。用户手动完成选择
 * （chooseStandalone/chooseOnline）同样打标记。
 *
 * 安全取舍：引导值为公网明文 HTTP 时不弹 mode-select 的明文链路警告
 * （docs/security-model.md「明文 HTTP」已列为有意取舍；引导地址由部署者
 * 拍板，弹窗反而破坏「新机免配置」的目标）。
 */
import Taro from '@tarojs/taro';
import { ApiClient } from '@dustnote/shared';
import { taroFetch } from './taro-fetch';
import { APP_VERSION } from '../state/auth';

export const DEPLOY_DEFAULT_SERVER_URL = 'http://154.217.234.125:8080';

const APPLIED_KEY = 'dustnote_deploy_default_applied';

/** 部署默认值是否已应用过（一次性；读失败视为未应用，重放一次无副作用） */
export function isDeployDefaultApplied(): boolean {
  try {
    return !!Taro.getStorageSync(APPLIED_KEY);
  } catch {
    return false;
  }
}

export function markDeployDefaultApplied(): void {
  try {
    Taro.setStorageSync(APPLIED_KEY, true);
  } catch {
    /* 存储不可用时忽略：最坏情况是下次启动再应用一次（幂等） */
  }
}

function newApiClient(serverUrl: string): ApiClient {
  return new ApiClient({
    baseUrl: `${serverUrl.replace(/\/+$/, '')}/api/v1`,
    clientVersion: APP_VERSION,
    platform: 'miniprogram',
    channel: 'stable',
    deviceId: 'deploy-bootstrap',
    timeoutMs: 8000,
    fetch: process.env.TARO_ENV === 'weapp' ? taroFetch : undefined,
  });
}

/**
 * 解析部署目标地址：引导地址可达时，返回「服务端登记的规范地址」；
 * 可达但尚无登记（全新库）→ 回退引导地址本身（它就是这台服务器）。
 * 引导地址不可达 / 响应异常 → ok:false（调用方展示地址失效提示）。
 */
export async function resolveDeployServerUrl(
  bootstrapUrl: string
): Promise<{ ok: true; serverUrl: string } | { ok: false }> {
  try {
    const api = newApiClient(bootstrapUrl);
    const r = await api.get<{ serverUrl: string | null }>('/config/server-endpoint');
    const raw = typeof r.serverUrl === 'string' ? r.serverUrl.trim() : '';
    const fallback = bootstrapUrl.replace(/\/+$/, '');
    const serverUrl = /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, '') : fallback;
    return { ok: true, serverUrl };
  } catch {
    return { ok: false };
  }
}

/**
 * 把首次激活输入的地址登记到该服务器（先到先得;已登记同值幂等,不同值 409）。
 * 失败静默——服务端未跑新版本/网络抖动都可能出现,不阻塞激活流程。
 */
export async function registerCanonicalServerUrl(serverUrl: string): Promise<void> {
  try {
    const api = newApiClient(serverUrl);
    await api.post('/config/server-endpoint', { serverUrl: serverUrl.replace(/\/+$/, '') });
  } catch {
    /* 登记失败不阻塞激活 */
  }
}
