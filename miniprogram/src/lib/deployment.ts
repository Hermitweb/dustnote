/**
 * 部署预置配置（发布包构建期决定）
 *
 * DEPLOY_DEFAULT_SERVER_URL 非空时，**首次启动**跳过模式选择与地址输入，
 * 直接以联机模式 + 该地址初始化；地址随即持久化到 mode-store
 * （dustnote_mode_state），之后可在 设置页 → 服务器地址 随时修改。
 * 开发构建保持空串即可走完整的「选择模式 + 输地址」流程。
 *
 * 只自动应用一次（APPLIED_KEY 标记）：用户之后从设置页「切换模式」回到
 * 选择页时仍可自由选单机，不会被每次启动强拉回联机。
 *
 * 安全取舍：预置值为公网明文 HTTP 时不弹 mode-select 的明文链路警告
 * （docs/security-model.md「明文 HTTP」已列为有意取舍；预置地址由部署者
 * 拍板，弹窗反而破坏「新机免配置」的目标）。
 */
import Taro from '@tarojs/taro';

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
