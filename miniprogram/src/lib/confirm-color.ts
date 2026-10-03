/**
 * 原生 showModal 的 confirmColor 只能吃字面量 hex（不是 CSS 变量），
 * 所以它必须从种子派生，而不是抄在调用点上 —— 此前 14 处写的是
 * #E07B6C（品牌改蓝之前的一版珊瑚色），既不跟主题也不跟明暗。
 */
import { useThemeStore, currentEffectiveTheme } from '../state/theme';
import { confirmDanger } from './theme-chrome';

export function confirmDangerColor(): string {
  const s = useThemeStore.getState();
  return confirmDanger(currentEffectiveTheme(s.theme, s.systemDark === true));
}
