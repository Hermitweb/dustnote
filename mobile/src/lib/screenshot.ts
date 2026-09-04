/**
 * 截屏开关(Android FLAG_SECURE 的用户可配置化):
 *
 * - 默认禁止截屏(security.md §3.6,防笔记内容泄露)
 * - 设置页开关可开放(如向开发者反馈截图),即时生效
 * - 应用启动时恢复持久化值;仅 Android 生效(iOS 本就允许截屏)
 */

import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'dustnote_allow_screenshot';

function native(): { setAllowed: (v: boolean) => void } | null {
  if (Platform.OS !== 'android') return null;
  const mod = NativeModules.DustNoteScreenshot as
    | { setAllowed?: (v: boolean) => void }
    | undefined;
  return mod && typeof mod.setAllowed === 'function' ? { setAllowed: mod.setAllowed.bind(mod) } : null;
}

/** 应用启动时调用:按持久化设置恢复 FLAG_SECURE 状态 */
export async function applyScreenshotSetting(): Promise<void> {
  const mod = native();
  if (!mod) return;
  try {
    const allowed = (await AsyncStorage.getItem(KEY)) === '1';
    mod.setAllowed(allowed);
  } catch {
    /* ignore */
  }
}

/** 设置页开关:持久化 + 立即生效 */
export async function setScreenshotAllowed(allowed: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY, allowed ? '1' : '0');
  native()?.setAllowed(allowed);
}

export async function getScreenshotAllowed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}
