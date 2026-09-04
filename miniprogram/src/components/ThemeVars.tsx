/**
 * 页面主题注入(weapp)
 *
 * 双机制:
 * 1. <PageMeta pageStyle> 写页面字面量背景/前景色(自定义 CSS 变量在
 *    page-style 中不级联,已实测),保证页面底色与文字颜色随主题
 * 2. useThemeDarkClass() 返回 'theme-dark' | '',由各页根 View 拼接——
 *    .theme-dark 类(App.scss)注入整套深色变量,组件 var() 引用全部联动
 *
 * 导航栏颜色同步 setNavigationBarColor;auto 模式跟随系统(onThemeChange)。
 */
import { PageMeta } from '@tarojs/components';
import { useEffect } from 'react';
import Taro from '@tarojs/taro';
import { useThemeStore, currentEffectiveTheme } from '../state/theme';

const BG = { light: '#FAFCF9', dark: '#0b1120' } as const;
const FG = { light: '#1F2D26', dark: '#e8edf4' } as const;

/** 各页根 View 拼接:手动/自动深色时返回 'theme-dark' */
export function useThemeDarkClass(): string {
  const theme = useThemeStore((s) => s.theme);
  const systemDark = useThemeStore((s) => s.systemDark);
  const refreshSystemTheme = useThemeStore((s) => s.refreshSystemTheme);

  useEffect(() => {
    refreshSystemTheme();
    if (typeof Taro.onThemeChange === 'function') {
      Taro.onThemeChange((res) => {
        useThemeStore.setState({ systemDark: res.theme === 'dark' });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effective = currentEffectiveTheme(theme, systemDark === true);
  return effective === 'dark' ? 'theme-dark' : '';
}

export function ThemeVars() {
  const theme = useThemeStore((s) => s.theme);
  const systemDark = useThemeStore((s) => s.systemDark);
  const refreshSystemTheme = useThemeStore((s) => s.refreshSystemTheme);
  const effective = currentEffectiveTheme(theme, systemDark === true);

  // 系统深浅模式变化(与 useThemeDarkClass 保持同一监听)
  useEffect(() => {
    refreshSystemTheme();
    if (typeof Taro.onThemeChange === 'function') {
      Taro.onThemeChange((res) => {
        useThemeStore.setState({ systemDark: res.theme === 'dark' });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 导航栏随主题
  useEffect(() => {
    try {
      Taro.setNavigationBarColor({
        frontColor: effective === 'dark' ? '#ffffff' : '#000000',
        backgroundColor: effective === 'dark' ? '#0b1120' : '#FAFCF9',
        fail: () => undefined,
      });
    } catch {
      /* ignore */
    }
  }, [effective]);

  // 页面根字面量背景/前景(自定义变量不级联,见文件头)
  return <PageMeta pageStyle={`background-color:${BG[effective]};color:${FG[effective]}`} />;
}
