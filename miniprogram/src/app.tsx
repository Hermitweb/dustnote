/**
 * 小程序入口
 *
 * 注册全局状态 + 启动数据 + 全局错误兜底
 */

import type { ReactNode } from 'react';
import Taro from '@tarojs/taro';
import { useLaunch } from '@tarojs/taro';
import { AuthProvider } from './state/auth';
import { useThemeStore, applyTheme } from './state/theme';
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
      console.error('[DustNote] 未捕获的异步错误:', res?.reason ?? res);
    });

    // 页面不存在兜底（路由配置错误或分包加载失败时触发）
    Taro.onPageNotFound(() => {
      Taro.reLaunch({ url: '/pages/mode-select/index' });
    });

    applyTheme(theme);
  });

  return <AuthProvider>{children}</AuthProvider>;
}

export default App;
