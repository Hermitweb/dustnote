/**
 * 语音输入按钮（B-8 懒人化体验）
 *
 * 基于 Web Speech API（webkitSpeechRecognition），仅 Chromium 内核浏览器支持。
 * - 点击开始听写，再次点击停止
 * - 识别文本通过 onInsert 回调插入到编辑器光标处
 * - 连续模式 + zh-CN 默认，失败时友好降级提示
 *
 * 不支持时按钮禁用并显示 tooltip
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Web Speech API 类型声明（浏览器私有，TS 没有）
interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceInputButton({
  onInsert,
}: {
  onInsert: (text: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [listening, setListening] = useState(false);
  const [supported] = useState<boolean>(() => getSpeechRecognitionCtor() !== null);
  const [error, setError] = useState<string | null>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  // 累积最终结果（interimResults 模式下每次 result 事件会带 final 段）
  const finalBuffer = useRef('');

  useEffect(() => {
    return () => {
      recogRef.current?.abort();
    };
  }, []);

  const toggle = () => {
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError(t('settings.voice_not_supported'));
      return;
    }
    setError(null);
    finalBuffer.current = '';
    const recog = new Ctor();
    recog.lang = i18n.language === 'en' ? 'en-US' : 'zh-CN';
    recog.continuous = true;
    recog.interimResults = true;
    recog.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res) continue;
        const transcript = res[0]?.transcript ?? '';
        if (res.isFinal) {
          finalBuffer.current += transcript;
        } else {
          interim += transcript;
        }
      }
      // 实时插入 interim，便于用户感知；最终段会在 onend 时统一提交
      // 这里只在 final 增量时回调，避免频繁插入
      if (finalBuffer.current.length > 0) {
        onInsert(transcriptSlice(finalBuffer.current));
        finalBuffer.current = '';
      }
      void interim;
    };
    recog.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed') {
        setError(t('voice_input.not_allowed'));
      } else {
        setError(e.error);
      }
    };
    recog.onend = () => {
      if (finalBuffer.current.length > 0) {
        onInsert(finalBuffer.current);
        finalBuffer.current = '';
      }
      setListening(false);
    };
    recogRef.current = recog;
    try {
      recog.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  if (!supported) {
    return (
      <button
        disabled
        title={t('settings.voice_not_supported')}
        className="rounded p-1.5 text-xs text-surface-muted opacity-40"
      >
        🎤
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      title={listening ? t('voice_input.stop') : t('voice_input.start')}
      className={`rounded p-1.5 text-xs ${
        listening
          ? 'animate-pulse bg-red-100 text-red-600 dark:bg-red-900/40'
          : 'text-surface-muted hover:bg-surface-bg'
      }`}
    >
      🎤
      {error && (
        <span className="sr-only" role="alert">
          {error}
        </span>
      )}
    </button>
  );
}

/** 取最后一句话（避免频繁插入中间结果导致重复） */
function transcriptSlice(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed;
}
