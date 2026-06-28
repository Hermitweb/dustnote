/**
 * 小程序入口
 *
 * 小程序的 App 是 @tarojs/redux 风格的 Provider 包装器
 * 注册全局状态 + 启动数据
 */

import type { ReactNode } from 'react';
import { useLaunch } from '@tarojs/taro';
import { AuthProvider, useAuthInit } from './state/auth';
import { useThemeStore, applyTheme } from './state/theme';
import './app.scss';

function App({ children }: { children?: ReactNode }) {
  const theme = useThemeStore((s) => s.theme);
  // 启动：检查初始化状态 + 应用主题
  useLaunch(() => {
    console.log('🌿 DustNote 小程序启动');
    applyTheme(theme);
  });

  return <AuthProvider>{children}</AuthProvider>;
}

export default App;
