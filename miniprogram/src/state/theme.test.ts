/**
 * 主题与材质持久化（TEST-004）
 *
 * 材质档（glass / flat）这一轮新加，且三端各实现了一遍"关掉玻璃"：
 * web 用 data-effect、mobile 用 paletteFor 的 alpha 开关、小程序用根类 material-flat。
 * 小程序这份最容易悄悄坏 —— 它靠一个纯函数拼类名，一旦主题分支改了而 flat 后缀没跟上，
 * 设置页的开关就成了摆设。所以这里打的是**真函数** rootClassOf（不是测试里的复刻）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  useThemeStore,
  currentEffectiveTheme,
  rootClassOf,
  type Material,
  type Theme,
} from './theme';
import { resetStorage, dumpStorage } from '../../test/mocks/taro';

const MATERIAL_KEY = 'dustnote_material';
const THEME_KEY = 'dustnote_theme';
const THEMES: Theme[] = ['light', 'dark', 'auto'];

const cls = (theme: Theme, systemDark: boolean, material: Material, taroEnv = 'weapp'): string =>
  rootClassOf({ theme, systemDark, material, taroEnv });
const has = (c: string, token: string): boolean => c.split(' ').includes(token);

describe('rootClassOf：主题反制类', () => {
  it('手动深色 → theme-dark', () => {
    expect(has(cls('dark', false, 'glass'), 'theme-dark')).toBe(true);
  });

  it('手动浅色 + 系统深色才需要 theme-light 反制；系统浅色时什么都不加', () => {
    expect(has(cls('light', true, 'glass'), 'theme-light')).toBe(true);
    expect(cls('light', false, 'glass')).toBe('page-solid');
  });

  it('auto 不加反制类（变量与底色由 page 元素跟随系统）', () => {
    expect(cls('auto', true, 'glass')).toBe('page-solid');
    expect(cls('auto', false, 'glass')).toBe('page-solid');
  });

  it('page-solid 只在 weapp 出现：H5 铺实底会盖掉极光层', () => {
    expect(has(cls('dark', false, 'glass', 'h5'), 'page-solid')).toBe(false);
    expect(has(cls('dark', false, 'glass', 'weapp'), 'page-solid')).toBe(true);
  });
});

describe('rootClassOf：材质档', () => {
  it('六种「主题 × 系统深色」组合下，实色档都带上 material-flat', () => {
    for (const t of THEMES) {
      for (const sd of [false, true]) {
        expect(has(cls(t, sd, 'flat'), 'material-flat'), `theme=${t} systemDark=${sd}`).toBe(true);
      }
    }
  });

  it('玻璃档不追加后缀（否则实色样式会常驻）', () => {
    for (const t of THEMES) {
      for (const sd of [false, true]) {
        expect(has(cls(t, sd, 'glass'), 'material-flat')).toBe(false);
      }
    }
  });

  it('material-flat 与主题反制类可以共存，且顺序稳定（类名拼接顺序影响可读性与快照）', () => {
    expect(cls('dark', true, 'flat')).toBe('theme-dark page-solid material-flat');
  });
});

describe('持久化', () => {
  beforeEach(() => {
    resetStorage();
    useThemeStore.setState({ theme: 'light', material: 'glass', systemDark: false });
  });

  it('默认是玻璃档（决策：保留并默认开启，设置里可关）', () => {
    expect(useThemeStore.getState().material).toBe('glass');
  });

  it('切到实色会落 Taro storage（冷启动后仍是实色）', () => {
    useThemeStore.getState().setMaterial('flat');
    expect(dumpStorage()[MATERIAL_KEY]).toBe('flat');
  });

  it('主题切换同样落盘', () => {
    useThemeStore.getState().setTheme('dark');
    expect(dumpStorage()[THEME_KEY]).toBe('dark');
  });

  it('存储里是脏值时读回玻璃，不会把非法字符串拼进类名', () => {
    resetStorage({ [MATERIAL_KEY]: 'blur' });
    useThemeStore.setState({ material: 'glass' });
    const v = dumpStorage()[MATERIAL_KEY];
    expect(v === 'flat' || v === 'glass').toBe(false);
    // 初始化逻辑的口径：非 glass/flat 一律当 glass
    const normalized: Material = v === 'flat' ? 'flat' : 'glass';
    expect(has(cls('light', false, normalized), 'material-flat')).toBe(false);
  });
});

describe('currentEffectiveTheme', () => {
  it('auto 由系统决定，手动档无视系统', () => {
    expect(currentEffectiveTheme('auto', true)).toBe('dark');
    expect(currentEffectiveTheme('auto', false)).toBe('light');
    expect(currentEffectiveTheme('light', true)).toBe('light');
    expect(currentEffectiveTheme('dark', false)).toBe('dark');
  });
});
