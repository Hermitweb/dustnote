/**
 * 开机自启桥接（TEST-004）
 *
 * 这里要钉住的是"环境门槛"和"失败不许冒泡"：
 * 浏览器里没有插件，误调会抛错打断设置页；查询失败必须回落到 false，
 * 否则 UI 会在"看起来已开启"的状态下继续往下走。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  enable,
  disable,
  isEnabled,
  resetAutostart,
  state,
} from '../../test/mocks/tauri-autostart';
import {
  registerAutostartApi,
  getAutostartApi,
  setAutostart,
  isAutostartEnabled,
} from './autostart';

const TAURI_FLAG = '__TAURI_INTERNALS__';
function asDesktop(on: boolean): void {
  if (on) (window as unknown as Record<string, unknown>)[TAURI_FLAG] = {};
  else delete (window as unknown as Record<string, unknown>)[TAURI_FLAG];
}

describe('autostart', () => {
  beforeEach(() => {
    resetAutostart();
    asDesktop(true);
    registerAutostartApi();
  });
  afterEach(() => asDesktop(false));

  it('浏览器环境不注册，取用为 null，切换是 no-op', async () => {
    asDesktop(false);
    expect(getAutostartApi()).toBeNull();
    await setAutostart(true);
    expect(enable).not.toHaveBeenCalled();
    await expect(isAutostartEnabled()).resolves.toBe(false);
  });

  it('开与关分别落到插件的 enable / disable', async () => {
    await setAutostart(true);
    expect(enable).toHaveBeenCalledTimes(1);
    expect(state.enabled).toBe(true);
    await setAutostart(false);
    expect(disable).toHaveBeenCalledTimes(1);
    expect(state.enabled).toBe(false);
  });

  it('查询失败回落 false，而不是把异常抛给设置页', async () => {
    isEnabled.mockRejectedValueOnce(new Error('plugin unavailable'));
    await expect(isAutostartEnabled()).resolves.toBe(false);
  });
});
