/**
 * 语音听写封装(@react-native-voice/voice)
 *
 * 仅 Android 构建(库 autolink);回调在全局单例上注册,使用前先销毁旧实例。
 * 真机需要麦克风权限(Android 由库 manifest 合并,首次使用时系统弹窗)。
 */
import Voice from '@react-native-voice/voice';

// 回调参数放宽:any——该库的类型定义(setter 与方法重载混用)会让
// 严格字面量签名报 TS2559,运行时签名与 SpeechResultsEvent 一致
type SpeechResultCb = (e: { value?: string[] }) => void;
type SpeechErrorCb = (e: { message?: string }) => void;

export interface VoiceHandlers {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

let handlers: VoiceHandlers | null = null;
let active = false;

export async function startVoice(h: VoiceHandlers): Promise<boolean> {
  try {
    handlers = h;
    Voice.destroy();
    // 库类型定义的 setter/方法重载混用导致严格回调签名报错——运行时行为
    // 以 README 为准,此处放宽回调参数
    const V = Voice as unknown as Record<string, (fn: (e: never) => void) => void>;
    V.onSpeechResults(((e: { value?: string[] }) => {
      const text = e.value?.join(' ') ?? '';
      handlers?.onPartial(text);
    }) as never);
    V.onSpeechPartialResults(((e: { value?: string[] }) => {
      const text = e.value?.join(' ') ?? '';
      handlers?.onPartial(text);
    }) as never);
    V.onSpeechEnd(() => {
      active = false;
      handlers?.onEnd();
    });
    V.onSpeechError(((e: { message?: string }) => {
      active = false;
      handlers?.onError(e?.message ?? '语音识别失败');
    }) as never);
    await Voice.start('zh-CN');
    active = true;
    return true;
  } catch {
    return false;
  }
}

export async function stopVoice(): Promise<void> {
  if (!active) return;
  try {
    await Voice.stop();
  } catch {
    /* ignore */
  }
  active = false;
}

export function isVoiceActive(): boolean {
  return active;
}
