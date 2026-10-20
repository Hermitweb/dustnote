/**
 * UpdateBanner 测试
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { UpdateBanner } from '../components/UpdateBanner';
import type { CheckUpdateResult, ForceUpdateLevel } from '@dustnote/shared';

const baseResult = (
  // exactOptionalPropertyTypes 下显式传 undefined 需要带上 | undefined
  overrides: { level?: ForceUpdateLevel; updateUrl?: string | undefined; version?: string } = {}
): CheckUpdateResult => {
  const result: CheckUpdateResult = {
    status: 'ok',
    forceLevel: (overrides.level as ForceUpdateLevel | null) ?? null,
    updateUrl: overrides.updateUrl,
    message: 'msg',
    manifest: overrides.version ? { latest: { version: overrides.version } } : undefined,
  } as unknown as CheckUpdateResult;
  return result;
};

describe('UpdateBanner', () => {
  afterEach(() => cleanup());

  it('L2 强提示：渲染升级链接', () => {
    const r = render(
      <UpdateBanner
        result={baseResult({ level: 'L2_strong_prompt', updateUrl: 'https://example.com/up' })}
      />
    );
    const a = r.container.querySelector('a') as HTMLAnchorElement;
    expect(a).toBeTruthy();
    expect(a.getAttribute('href')).toBe('https://example.com/up');
    expect(r.container.textContent).toContain('update.suggest_upgrade');
  });

  it('L3 软提示：渲染 "available" 文案', () => {
    const r = render(
      <UpdateBanner result={baseResult({ level: 'L3_soft_prompt', updateUrl: 'https://x' })} />
    );
    expect(r.container.textContent).toContain('update.available');
  });

  it('L0 / L1：不渲染', () => {
    // L0 的合法档位是 L0_block（生产类型 ForceUpdateLevel 枚举）
    const r0 = render(
      <UpdateBanner result={baseResult({ level: 'L0_block', updateUrl: 'https://x' })} />
    );
    expect(r0.container.firstChild).toBeNull();
  });

  it('没有 updateUrl → 不渲染', () => {
    const r = render(
      <UpdateBanner result={baseResult({ level: 'L2_strong_prompt', updateUrl: undefined })} />
    );
    expect(r.container.firstChild).toBeNull();
  });

  it('点击关闭按钮 → 立即消失', async () => {
    const r = render(
      <UpdateBanner result={baseResult({ level: 'L2_strong_prompt', updateUrl: 'https://x' })} />
    );
    const close = r.container.querySelector('[aria-label="common.close"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(close);
    });
    expect(r.container.firstChild).toBeNull();
  });
});
