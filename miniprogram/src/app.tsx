/**
 * 小程序入口
 *
 * 注册全局状态 + 启动数据 + 全局错误兜底
 */

import type { ReactNode } from 'react';
// 必须在任何加密操作前先注入安全随机源（微信小程序无 WebCrypto）
import './lib/crypto-polyfill';
import Taro from '@tarojs/taro';
import { useLaunch } from '@tarojs/taro';
import { AuthProvider } from './state/auth';
import { useThemeStore, applyTheme } from './state/theme';
import ConflictDialog from './components/ConflictDialog';
import { useModeStore } from './lib/mode-store';
import { useAuthStore } from './state/auth';
import { flushOfflineQueue } from './lib/offline-queue';
import './app.scss';

function App({ children }: { children?: ReactNode }) {
  const theme = useThemeStore((s) => s.theme);

  // 启动：注册全局错误兜底 + 应用主题
  useLaunch(() => {
    // 全局 JS 错误兜底：防止未捕获异常导致白屏
    Taro.onError((err) => {
      console.error('[DustNote] 全局错误:', err);
      Taro.showToast({ title: '应用遇到错误，请重试', icon: 'none', duration: 2000 });
    });

    // 未处理的 Promise rejection 兜底
    Taro.onUnhandledRejection((res) => {
      // 用户主动取消 ActionSheet/Modal 在部分基础库以 reject 形式抛出，属正常交互
      const reason = res?.reason;
      const errMsg = typeof reason === 'string' ? reason : (reason as { errMsg?: string })?.errMsg;
      if (errMsg && /cancel/.test(errMsg)) return;
      console.error('[DustNote] 未捕获的异步错误:', reason ?? res);
    });

    // 页面不存在兜底（路由配置错误或分包加载失败时触发）
    Taro.onPageNotFound(() => {
      Taro.reLaunch({ url: '/pages/mode-select/index' });
    });

    // 微信隐私授权（审计 LIFE-012）：__usePrivacyCheck__: true 后，任何隐私接口
    // （chooseMessageFile / openDocument 等）在用户未同意《用户隐私保护指引》时
    // 会挂起并触发本事件。这里弹官方授权弹窗：同意按钮用
    // open-type="agreePrivacyAuthorization"（基础库校验必须真实点击），
    // 「查看指引」可打开微信托管的隐私协议原文。仅 weapp 环境注册。
    if (process.env.TARO_ENV === 'weapp' && typeof Taro.onNeedPrivacyAuthorization === 'function') {
      Taro.onNeedPrivacyAuthorization((resolve) => {
        // 曝光上报：告知平台弹窗已展示（官方建议在弹窗渲染后调用）
        resolve({ event: 'exposureAuthorization' });
        Taro.showModal({
          title: '隐私保护指引',
          content:
            '使用文件选择、打开文档等能力前，需阅读并同意《用户隐私保护指引》。' +
            '你的笔记内容端到端加密，开发者无法读取。',
          confirmText: '同意',
          cancelText: '拒绝',
          success: (res) => {
            if (res.confirm) {
              // agree 需带真实被点击的同意按钮 id；showModal 的确认按钮由
              // 基础库代为校验（等价于 agreePrivacyAuthorization），无自定义
              // 按钮场景传 event 即可
              resolve({ event: 'agree' });
            } else {
              resolve({ event: 'disagree' });
            }
          },
          fail: () => resolve({ event: 'disagree' }),
        });
      });
    }

    applyTheme(theme);

    // 自动锁屏：切后台超过设定分钟数后，回前台时锁定（0 = 关闭）
    let hiddenAt = 0;
    Taro.onAppHide?.(() => {
      hiddenAt = Date.now();
    });
    Taro.onAppShow?.(() => {
      if (!hiddenAt) return;
      const min = Number(Taro.getStorageSync('dustnote_autolock_min') || 0);
      const { mode: m, initialized } = useModeStore.getState();
      const { authState, lock } = useAuthStore.getState();
      if (
        min > 0 &&
        initialized &&
        authState === 'unlocked' &&
        Date.now() - hiddenAt >= min * 60_000
      ) {
        try {
          lock();
          Taro.showToast({ title: '已自动锁定', icon: 'none' });
        } catch {
          /* 忽略 */
        }
      }
      hiddenAt = 0;
    });

    // 启动时重放离线队列（联机且已解锁时才有意义；编辑页只入队不主动
    // flush 的残留——冷启动补一轮，避免离线改动滞留到下次保存才同步）
    setTimeout(() => {
      const { mode } = useModeStore.getState();
      const { authState } = useAuthStore.getState();
      if (mode === 'online' && authState === 'unlocked') {
        void flushOfflineQueue().catch(() => undefined);
      }
    }, 3000);

    // 微信小程序更新检测
    // 当微信客户端检测到新版本的小程序时，提示用户重启
    // H5 端 getUpdateManager 虽存在但返回的对象缺 onCheckForUpdate 等方法，
    // 需同时探测方法本身（仅 weapp 有完整实现）
    if (process.env.TARO_ENV === 'weapp' && typeof Taro.getUpdateManager === 'function') {
      const updateManager = Taro.getUpdateManager();
      updateManager.onCheckForUpdate((res) => {
        if (res.hasUpdate) {
          console.log('[DustNote] 小程序有新版本可用');
        }
      });
      updateManager.onUpdateReady(() => {
        Taro.showModal({
          title: '更新提示',
          content: '新版本已准备好，是否重启应用？',
          success: (modalRes) => {
            if (modalRes.confirm) {
              updateManager.applyUpdate();
            }
          },
        });
      });
      updateManager.onUpdateFailed(() => {
        Taro.showToast({ title: '更新下载失败，请稍后重试', icon: 'none' });
      });
    }
  });

  return (
    <AuthProvider>
      {children}
      <ConflictDialog />
    </AuthProvider>
  );
}

export default App;
