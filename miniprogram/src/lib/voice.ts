/**
 * 语音听写封装(微信同声传译插件 WechatSI)
 *
 * - 前提:小程序管理后台已添加「同声传译」插件(app.json plugins 已声明)
 * - 真机需要麦克风权限;拒绝后 onError 收到 auth 类错误,引导 openSetting
 * - getRecordRecognitionManager 返回全局单例,模块级缓存复用
 */

import Taro from '@tarojs/taro';

export interface VoiceCallbacks {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (msg: string) => void;
  onEnd?: () => void;
}

interface WechatSIManager {
  start: (opts?: Record<string, unknown>) => void;
  stop: () => void;
  onRecognize: (cb: (res: { result?: string }) => void) => void;
  onStop: (cb: (res: { result?: string }) => void) => void;
  onError: (cb: (res: { msg?: string }) => void) => void;
}

let manager: WechatSIManager | null = null;

function getManager(): WechatSIManager {
  if (manager) return manager;
  const requirePlugin = (globalThis as {
    requirePlugin?: (name: string) => { getRecordRecognitionManager: () => WechatSIManager };
  }).requirePlugin;
  if (typeof requirePlugin !== 'function') {
    throw new Error('运行环境不支持语音插件');
  }
  manager = requirePlugin('WechatSI').getRecordRecognitionManager();
  return manager;
}

let bound = false;
let active: VoiceCallbacks | null = null;

function bind(cbs: VoiceCallbacks): void {
  const m = getManager();
  if (!bound) {
    m.onRecognize((res) => active?.onPartial?.(res.result ?? ''));
    m.onStop((res) => {
      active?.onFinal?.(res.result ?? '');
      active?.onEnd?.();
    });
    m.onError((res) => {
      const msg = res.msg ?? '语音识别失败';
      if (/auth|deny|permission/i.test(msg)) {
        active?.onError?.('需要麦克风权限:点右上角 → 设置 → 打开麦克风');
        try {
          void Taro.openSetting();
        } catch {
          /* ignore */
        }
      } else {
        active?.onError?.(msg);
      }
      active?.onEnd?.();
    });
    bound = true;
  }
  active = cbs;
}

/** 开始听写;成功返回 true(已开始),插件不可用返回 false */
export function startVoice(cbs: VoiceCallbacks): boolean {
  try {
    const m = getManager();
    bind(cbs);
    m.start({ duration: 60_000, lang: 'zh_CN' });
    return true;
  } catch (e) {
    cbs.onError?.(e instanceof Error ? e.message : '语音插件未就绪');
    return false;
  }
}

/** 结束听写(触发 onFinal) */
export function stopVoice(): void {
  try {
    getManager().stop();
  } catch {
    /* ignore */
  }
}
