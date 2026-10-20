/**
 * VoiceInputButton 测试
 *
 * 覆盖：
 * - 不支持 Web Speech API 时按钮 disabled 且 title 显示
 * - 支持时点击触发 start；再次点击触发 stop
 * - onresult 累积 final 段触发 onInsert
 * - onresult interim 段不触发 onInsert
 * - onerror 'no-speech' / 'aborted' 不显示错误
 * - onerror 'not-allowed' 显示 voice_input.not_allowed
 * - onerror 其他错误显示错误码
 * - onend 时如有未提交 buffer 调 onInsert
 * - start 抛错时回退为非 listening
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '../test/render';

const mockI18nLang = vi.fn(() => 'zh-CN');

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: {
      get language() {
        return mockI18nLang();
      },
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

let recogInstance: any = null;
function makeInstance(startImpl: () => void = () => undefined) {
  return {
    lang: '',
    continuous: false,
    interimResults: false,
    onresult: null as ((e: unknown) => void) | null,
    onerror: null as ((e: unknown) => void) | null,
    onend: null as (() => void) | null,
    start: vi.fn(startImpl),
    stop: vi.fn(() => undefined),
    abort: vi.fn(() => undefined),
  };
}
const RecogCtor = vi.fn(() => {
  recogInstance = makeInstance();
  return recogInstance;
});

vi.mock('../lib/platform', () => ({ isTauri: () => false }));

import { VoiceInputButton } from './VoiceInputButton';

function installRecognition(available: boolean) {
  if (available) {
    (window as any).SpeechRecognition = RecogCtor;
  } else {
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
  }
}

describe('VoiceInputButton', () => {
  beforeEach(() => {
    recogInstance = null;
    RecogCtor.mockClear();
  });
  afterEach(() => {
    cleanup();
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
    vi.clearAllMocks();
  });

  it('不支持 Web Speech API 时按钮 disabled', () => {
    installRecognition(false);
    const { container } = render(<VoiceInputButton onInsert={() => undefined} />);
    const btn = container.querySelector('button');
    expect(btn?.disabled).toBe(true);
    expect(btn?.getAttribute('title')).toBe('settings.voice_not_supported');
  });

  it('支持时点击触发 start；再次点击触发 stop', () => {
    installRecognition(true);
    const onInsert = vi.fn();
    const { container } = render(<VoiceInputButton onInsert={onInsert} />);
    const btn = container.querySelector('button');
    fireEvent.click(btn!);
    expect(recogInstance).not.toBeNull();
    expect(recogInstance.start).toHaveBeenCalled();
    fireEvent.click(btn!);
    expect(recogInstance.stop).toHaveBeenCalled();
  });

  it('onresult final 段累积触发 onInsert', () => {
    installRecognition(true);
    const onInsert = vi.fn();
    const { container } = render(<VoiceInputButton onInsert={onInsert} />);
    fireEvent.click(container.querySelector('button')!);
    recogInstance.onresult({
      resultIndex: 0,
      results: [{ 0: { transcript: '你好' }, isFinal: true }],
    });
    expect(onInsert).toHaveBeenCalled();
  });

  it('onresult interim 段不立即触发 onInsert', () => {
    installRecognition(true);
    const onInsert = vi.fn();
    const { container } = render(<VoiceInputButton onInsert={onInsert} />);
    fireEvent.click(container.querySelector('button')!);
    recogInstance.onresult({
      resultIndex: 0,
      results: [{ 0: { transcript: '你好' }, isFinal: false }],
    });
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('onerror "no-speech" / "aborted" 不显示错误', () => {
    installRecognition(true);
    const { container } = render(<VoiceInputButton onInsert={() => undefined} />);
    fireEvent.click(container.querySelector('button')!);
    act(() => {
      recogInstance.onerror({ error: 'no-speech' });
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    act(() => {
      recogInstance.onerror({ error: 'aborted' });
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('onerror "not-allowed" 显示 voice_input.not_allowed', () => {
    installRecognition(true);
    const { container } = render(<VoiceInputButton onInsert={() => undefined} />);
    fireEvent.click(container.querySelector('button')!);
    act(() => {
      recogInstance.onerror({ error: 'not-allowed' });
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('voice_input.not_allowed');
  });

  it('onerror 其他错误显示错误码', () => {
    installRecognition(true);
    const { container } = render(<VoiceInputButton onInsert={() => undefined} />);
    fireEvent.click(container.querySelector('button')!);
    act(() => {
      recogInstance.onerror({ error: 'audio-capture' });
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('audio-capture');
  });

  it('onend 触发时 listening 被设回 false', () => {
    installRecognition(true);
    const { container } = render(<VoiceInputButton onInsert={() => undefined} />);
    const btn = container.querySelector('button')!;
    fireEvent.click(btn);
    expect(recogInstance).not.toBeNull();
    // 监听中态
    expect(btn.className).toContain('animate-pulse');
    act(() => {
      recogInstance.onend();
    });
    // listening 状态由 setListening(false) 重置
    expect(btn.className).not.toContain('animate-pulse');
  });

  it('start 抛错时回退为非 listening（标题变 start）', () => {
    installRecognition(true);
    RecogCtor.mockImplementation(() => {
      recogInstance = makeInstance(() => {
        throw new Error('mic busy');
      });
      return recogInstance;
    });
    const { container } = render(<VoiceInputButton onInsert={() => undefined} />);
    const btn = container.querySelector('button');
    fireEvent.click(btn!);
    // start 抛错 → listening 仍 false → title 是 start
    expect(btn?.getAttribute('title')).toBe('voice_input.start');
  });

  it('卸载组件时 abort 残留识别', () => {
    installRecognition(true);
    const { unmount } = render(<VoiceInputButton onInsert={() => undefined} />);
    const btn = document.querySelector('button');
    fireEvent.click(btn!);
    unmount();
    expect(recogInstance.abort).toHaveBeenCalled();
  });
});
