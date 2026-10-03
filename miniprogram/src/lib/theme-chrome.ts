/**
 * 小程序「原生外壳」的颜色出口
 *
 * 为什么单独一个模块：有三处颜色**只能吃字面量 hex**，走不了 CSS 变量 ——
 *   1) wx.setNavigationBarColor（导航栏底色 / 前景）；
 *   2) Taro.setPageStyle / PageMeta 的 pageStyle（页面根背景，H5 下会盖过 :root）；
 *   3) showModal 的 confirmColor（原生弹窗按钮）。
 * 这三处在改造前是手抄的 hex，而且抄出了**三份互不相同的页面底色**：
 *   ThemeVars BG.light #EAEFF8 / app.tsx 极光底 #eaeff8 / 导航栏 #FAFCF9
 *   —— 而 theme-tokens.scss 里 --bg(light) 其实是 #e4ebf8；深色同理
 *   （手抄 #0a1128 vs 令牌 #091128，差一个 16 进制位，导航栏与页面之间那条缝看得见）。
 * 现在全部从同一份种子派生：改主题只改 shared/src/theme-seeds.ts，这里跟着动。
 *
 * 主题 id 必须与 scripts/gen-mp-tokens.mjs 的 THEME_ID 一致 —— 两处都写死同一个常量，
 * 由 pnpm ui:check 断言（不一致就等于 CSS 用一套种子、原生外壳用另一套）。
 */
import { THEME_SEEDS, deriveTokens, toHex, type DerivedTokens } from '@dustnote/shared';

export const MP_THEME_ID = 'liquid-glass';

export type ChromeMode = 'light' | 'dark';

/** 通用取令牌（hex）：原生外壳与少数必须吃字面量的场合共用 */
export const chromeToken = (mode: ChromeMode, key: keyof DerivedTokens): string => token(mode, key);

function token(mode: ChromeMode, key: keyof DerivedTokens): string {
  const seed = THEME_SEEDS[MP_THEME_ID];
  if (!seed) throw new Error(`主题种子不存在：${MP_THEME_ID}`);
  // 键类型是 keyof DerivedTokens：写错令牌名在编译期就红，不会到运行时才抛
  return toHex(deriveTokens(seed[mode], mode)[key]);
}

/** 页面/导航栏底色（= CSS 里的 --bg，两处必须同源） */
export const pageBg = (mode: ChromeMode): string => token(mode, 'surface-0');

/** 页面根文字色（= CSS 里的 --fg） */
export const pageFg = (mode: ChromeMode): string => token(mode, 'text-primary');

/**
 * 导航栏前景。weapp 只接受 #ffffff / #000000 两个值（不是建议，是 API 约束），
 * 所以这里只能二选一，不能直接用 --fg。
 */
export const navFront = (mode: ChromeMode): string => (mode === 'dark' ? '#ffffff' : '#000000');

/** 原生确认框的"危险操作"按钮色（= 实心底那一档，与 --danger-solid 同源） */
export const confirmDanger = (mode: ChromeMode): string => token(mode, 'danger-solid');

/** 极光层的底色：与页面底色同源，不再另抄一份 */
export const auroraBase = (mode: ChromeMode): string => token(mode, 'surface-0');
