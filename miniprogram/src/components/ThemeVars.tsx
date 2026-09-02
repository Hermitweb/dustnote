/**
 * 页面主题变量注入（weapp）
 *
 * 小程序 WXSS 的 CSS 变量定义在 page 选择器上无法运行时切换；
 * 通过 <PageMeta pageStyle> 把整套变量注入当前页面根节点，
 * 每个页面渲染 <ThemeVars /> 即可获得与主题联动的全部变量，
 * 并同步导航栏颜色。auto 模式跟随系统（app.json darkmode: true）。
 */
import { PageMeta } from '@tarojs/components';
import { useEffect } from 'react';
import Taro from '@tarojs/taro';
import { useThemeStore } from '../state/theme';

const LIGHT: Record<string, string> = {
  '--bg': '#FAFCF9',
  '--bg-elevated': '#FFFFFF',
  '--bg-sunken': '#F1F6F2',
  '--fg': '#1F2D26',
  '--fg-secondary': '#5C6B63',
  '--fg-muted': '#8B9690',
  '--border': '#E3EBE6',
  '--border-strong': '#C5D5CA',
  '--primary': '#5fbc93',
  '--primary-strong': '#4fb783',
  '--primary-deep': '#3d9068',
  '--primary-soft': '#E8F5EE',
  '--primary-glow': 'rgba(79, 183, 131, 0.25)',
  '--danger-soft': '#FEECEC',
  '--card': '#FFFFFF',
};

const DARK: Record<string, string> = {
  '--bg': '#0b1120',
  '--bg-elevated': '#151d2e',
  '--bg-sunken': '#060b16',
  '--fg': '#e8edf4',
  '--fg-secondary': '#a8b5c8',
  '--fg-muted': '#68748a',
  '--border': '#263040',
  '--border-strong': '#354558',
  '--primary': '#5fbc93',
  '--primary-strong': '#5fbc93',
  '--primary-deep': '#7fd0a8',
  '--primary-soft': '#12231c',
  '--primary-glow': 'rgba(95, 188, 147, 0.15)',
  '--danger-soft': '#2d1518',
  '--card': '#151d2e',
};

export function ThemeVars() {
  const theme = useThemeStore((s) => s.theme);
  const systemDark = useThemeStore((s) => s.systemDark);
  const refreshSystemTheme = useThemeStore((s) => s.refreshSystemTheme);
  const effective = theme === 'auto' ? (systemDark ? 'dark' : 'light') : theme;
  const vars = effective === 'dark' ? DARK : LIGHT;
  const style = Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');

  // 系统深浅模式变化（darkmode: true 时微信会推送）
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

  return <PageMeta pageStyle={style} />;
}
