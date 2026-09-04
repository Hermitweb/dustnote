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
    // 回调注册必须用「赋值」:@react-native-voice/voice 的 onSpeechXxx 是
    // setter(只有 set 存取器),当方法调用会 TypeError(审计 H1)
    Voice.onSpeechResults = (e: { value?: string[] }) => {
      // 最终结果:写入正文(此前误映射 onPartial 导致文本永不落正文,审计 H2)
      const text = e.value?.join(' ') ?? '';
      if (text) handlers?.onFinal(text);
      active = false;
      handlers?.onEnd();
    };
    Voice.onSpeechPartialResults = (e: { value?: string[] }) => {
      const text = e.value?.join(' ') ?? '';
      handlers?.onPartial(text);
    };
    Voice.onSpeechEnd = () => {
      active = false;
      handlers?.onEnd();
    };
    Voice.onSpeechError = (e: { message?: string; error?: { code?: string; message?: string } }) => {
      active = false;
      handlers?.onError(e?.message || e?.error?.message || e?.error?.code || '语音识别失败');
      // 错误路径不保证再发 END:确保监听态复位(审计 M3)
      handlers?.onEnd();
    };
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
