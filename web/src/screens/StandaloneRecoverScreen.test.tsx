/**
 * StandaloneRecoverScreen 测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const store = vi.hoisted(() => ({
  recoverStandalone: vi.fn(async () => undefined),
}));

vi.mock('../lib/store', () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

import { StandaloneRecoverScreen } from '../screens/StandaloneRecoverScreen';

describe('StandaloneRecoverScreen', () => {
  beforeEach(() => store.recoverStandalone.mockClear());
  afterEach(() => cleanup());

  it('渲染标题 + 三个字段', () => {
    const r = render(<StandaloneRecoverScreen onBack={() => undefined} />);
    expect(r.container.textContent).toContain('auth.recover_title');
    expect(r.container.querySelectorAll('input').length).toBe(3);
  });

  it('点击返回 → 触发 onBack', () => {
    const onBack = vi.fn();
    const r = render(<StandaloneRecoverScreen onBack={onBack} />);
    const back = Array.from(r.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('auth.back_to_unlock')
    ) as HTMLElement;
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalled();
  });
});
