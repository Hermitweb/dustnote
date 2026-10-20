/**
 * ModeSelectDialog 测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const modeStore = vi.hoisted(() => ({
  mode: 'standalone' as 'standalone' | 'online',
  serverUrl: null as string | null,
  initialized: false,
  setMode: vi.fn(),
  setServerUrl: vi.fn(),
  initialize: vi.fn(),
}));

vi.mock('../lib/mode-store', () => ({
  useModeStore: Object.assign(
    (selector?: (s: typeof modeStore) => unknown) => (selector ? selector(modeStore) : modeStore),
    {
      getState: () => modeStore,
    }
  ),
}));

vi.mock('../lib/device', () => ({ getDeviceId: () => 'dev-1' }));

import { ModeSelectDialog } from '../components/ModeSelectDialog';

describe('ModeSelectDialog', () => {
  beforeEach(() => {
    modeStore.mode = 'standalone';
    modeStore.serverUrl = null;
    modeStore.initialized = false;
    modeStore.setMode.mockClear();
    modeStore.setServerUrl.mockClear();
    modeStore.initialize.mockClear();
  });
  afterEach(() => cleanup());

  it('渲染标题 + 两个模式按钮', () => {
    const r = render(<ModeSelectDialog />);
    expect(r.container.textContent).toContain('mode_select.title');
    expect(r.container.textContent).toContain('mode_select.standalone_title');
    expect(r.container.textContent).toContain('mode_select.online_title');
  });

  it('standalone 默认选中 → 隐藏 URL 框', () => {
    const r = render(<ModeSelectDialog />);
    expect(r.container.querySelector('input[type="url"]')).toBeNull();
  });

  it('点击 online 卡 → 显示 URL 输入框', () => {
    const r = render(<ModeSelectDialog />);
    const onlineBtn = Array.from(r.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('mode_select.online_title')
    ) as HTMLElement;
    fireEvent.click(onlineBtn);
    expect(r.container.querySelector('input[type="url"]')).toBeTruthy();
  });

  it('standalone handleContinue → setMode + onClose', () => {
    const onClose = vi.fn();
    const r = render(<ModeSelectDialog onClose={onClose} />);
    const submit = Array.from(r.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('continue_standalone')
    ) as HTMLElement;
    fireEvent.click(submit);
    expect(modeStore.setMode).toHaveBeenCalledWith('standalone');
    expect(onClose).toHaveBeenCalled();
  });
});
