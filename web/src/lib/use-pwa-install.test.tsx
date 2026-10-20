/**
 * usePwaInstall 测试
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '../test/render';
import { usePwaInstall } from '../lib/use-pwa-install';

function Probe() {
  const pwa = usePwaInstall();
  return (
    <div>
      <span data-test="can-install">{String(pwa.canInstall)}</span>
      <span data-test="installed">{String(pwa.installed)}</span>
      <button data-test="install" onClick={() => void pwa.install()}>
        install
      </button>
    </div>
  );
}

describe('usePwaInstall', () => {
  afterEach(() => cleanup());

  it('默认 installed=false，canInstall=false', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false } as MediaQueryList);
    const r = render(<Probe />);
    expect(r.container.querySelector('[data-test="installed"]')?.textContent).toBe('false');
    expect(r.container.querySelector('[data-test="can-install"]')?.textContent).toBe('false');
  });

  it('display-mode standalone → installed=true', () => {
    window.matchMedia = vi.fn(
      (q: string) =>
        ({
          matches: q.includes('display-mode: standalone'),
        }) as MediaQueryList
    );
    const r = render(<Probe />);
    expect(r.container.querySelector('[data-test="installed"]')?.textContent).toBe('true');
  });

  it('触发 beforeinstallprompt → canInstall=true', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false } as MediaQueryList);
    const r = render(<Probe />);
    const fakePrompt = {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    };
    await act(async () => {
      window.dispatchEvent(new CustomEvent('beforeinstallprompt', { detail: fakePrompt }));
    });
    const ev = new Event('beforeinstallprompt') as Event & typeof fakePrompt;
    Object.assign(ev, fakePrompt);
    await act(async () => {
      window.dispatchEvent(ev);
    });
    expect(r.container.querySelector('[data-test="can-install"]')?.textContent).toBe('true');
  });

  it('安装被 cancel → canInstall=true（仍可用）', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false } as MediaQueryList);
    const r = render(<Probe />);
    const fake = {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    };
    const ev = new Event('beforeinstallprompt') as Event & typeof fake;
    Object.assign(ev, fake);
    await act(async () => {
      window.dispatchEvent(ev);
    });
    expect(r.container.querySelector('[data-test="can-install"]')?.textContent).toBe('true');
  });
});
