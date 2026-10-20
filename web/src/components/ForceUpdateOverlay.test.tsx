/**
 * ForceUpdateOverlay 测试
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { ForceUpdateOverlay } from '../components/ForceUpdateOverlay';
import type { CheckUpdateResult } from '@dustnote/shared';

const baseResult = (overrides: Partial<CheckUpdateResult> = {}) =>
  ({
    forceLevel: 'L0_force_update',
    updateUrl: undefined,
    message: '升级',
    ...overrides,
  }) as unknown as CheckUpdateResult;

describe('ForceUpdateOverlay', () => {
  afterEach(() => cleanup());

  it('result.updateUrl 命中 → 渲染 <a href>', () => {
    const r = render(
      <ForceUpdateOverlay result={baseResult({ updateUrl: 'https://example.com/d' })} />
    );
    const a = r.container.querySelector('a') as HTMLAnchorElement;
    expect(a).toBeTruthy();
    expect(a.getAttribute('href')).toBe('https://example.com/d');
  });

  it('updateUrl 缺失 → 退回到 window.location.origin（同源）', () => {
    const r = render(<ForceUpdateOverlay result={baseResult()} />);
    const a = r.container.querySelector('a') as HTMLAnchorElement;
    expect(a).toBeTruthy();
    expect(a.getAttribute('href')).toBeTruthy();
  });

  it('StatePlate 接管视觉：含 title/hint', () => {
    const r = render(<ForceUpdateOverlay result={baseResult({ updateUrl: 'https://x' })} />);
    expect(r.container.textContent).toContain('settings.force_update_title');
    expect(r.container.textContent).toContain('settings.force_update_hint');
  });
});
