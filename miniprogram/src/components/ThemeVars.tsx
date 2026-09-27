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
import { useThemeStore, currentEffectiveTheme, rootClassOf } from '../state/theme';

const BG = { light: '#EAEFF8', dark: '#0a1128' } as const;
const FG = { light: '#1F2D26', dark: '#e8edf4' } as const;

let sysListenerBound = false;

function bindSystemThemeListener(): void {
  if (sysListenerBound) return;
  sysListenerBound = true;
  if (typeof Taro.onThemeChange === 'function') {
    Taro.onThemeChange((res) => {
      useThemeStore.setState({ systemDark: res.theme === 'dark' });
    });
  }
}

/** 各页根 View 拼接:手动深色→theme-dark;手动浅色+系统深色→theme-light;auto→''。
 *  weapp 额外拼 page-solid:手动主题时根 View 铺 var(--bg) 实底——page/.page
 *  在 app.scss 中全透明（背景交给极光层，而极光层在 weapp 不渲染:app 级
 *  render 只有 H5 输出），page 元素的 var(--bg) 只受 @media（系统）影响，
 *  手动暗色+系统浅色时会透出近白底（笔记列表偏白实锤）。auto 模式不拼:
 *  变量与底色都由 page 元素 @media 跟随系统，天然正确。
 *  H5 构建不拼（TARO_ENV 编译期内联）:极光层在 H5 渲染，铺实底会盖掉极光。 */
export function useThemeDarkClass(): string {
  const theme = useThemeStore((s) => s.theme);
  const material = useThemeStore((s) => s.material);
  const systemDark = useThemeStore((s) => s.systemDark);
  const refreshSystemTheme = useThemeStore((s) => s.refreshSystemTheme);

  useEffect(() => {
    refreshSystemTheme();
    bindSystemThemeListener();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return rootClassOf({
    theme,
    systemDark: systemDark === true,
    material,
    taroEnv: process.env.TARO_ENV ?? '',
  });
}

export function ThemeVars() {
  const theme = useThemeStore((s) => s.theme);
  const systemDark = useThemeStore((s) => s.systemDark);
  const refreshSystemTheme = useThemeStore((s) => s.refreshSystemTheme);
  const effective = currentEffectiveTheme(theme, systemDark === true);

  // 系统深浅模式变化(全局单次注册)
  useEffect(() => {
    refreshSystemTheme();
    bindSystemThemeListener();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 导航栏随应用主题（非系统）。systemDark 也入 deps：系统深浅切换时
  // darkmode 原生行为会用 theme.json 重置导航栏，手动偏好需重新声明。
  // 延迟重试：页面刚挂载时原生导航栏可能尚未就绪，过早调用会被静默丢弃。
  // weapp 直调 wx 原生 API——Taro 封装层在部分启动时序下会静默丢调用
  useEffect(() => {
    const apply = () => {
      const opts = {
        frontColor: effective === 'dark' ? '#ffffff' : '#000000',
        backgroundColor: effective === 'dark' ? '#0a1128' : '#FAFCF9',
        fail: () => undefined,
      };
      try {
        const g = globalThis as { wx?: { setNavigationBarColor?: (o: typeof opts) => void } };
        if (process.env.TARO_ENV === 'weapp' && typeof g.wx?.setNavigationBarColor === 'function') {
          g.wx.setNavigationBarColor(opts);
        } else {
          Taro.setNavigationBarColor(opts);
        }
      } catch {
        /* ignore */
      }
    };
    apply();
    const t1 = setTimeout(apply, 300);
    const t2 = setTimeout(apply, 1200);
    const t3 = setTimeout(apply, 3000);
    const t4 = setTimeout(apply, 6000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [effective, systemDark]);

  // 页面根字面量背景/前景(自定义变量不级联,见文件头)
  return <PageMeta pageStyle={`background-color:${BG[effective]};color:${FG[effective]}`} />;
}
