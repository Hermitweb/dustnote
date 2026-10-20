/**
 * web/src/screens/PublicShareView.tsx 单测 —— fetchShare 状态机各渲染分支
 *
 * 稳定化策略：使用 vi.useFakeTimers({ shouldAdvanceTime: true }) + runAllTimersAsync
 * 让 setState 的 microtask + React commit 同步完成，避免 jsdom 下 setState 跨测试时的
 * 竞态。每条用例独立 stub fetch + setHash，互不污染。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createElement } from 'react';
import { render, cleanup } from '../test/render';
import { installPolyfills } from '../test/polyfills';

installPolyfills();

// 稳定的 t 引用（避免 useTranslation 每次 render 返回新 t 导致 fetchShare useCallback 引用变化，
// 触发 useEffect 无限重试 → password_required 状态无法稳定停留）
const stableT = (k: string, opts?: Record<string, unknown>) =>
  opts ? `${k}:${JSON.stringify(opts)}` : k;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: stableT,
    i18n: { language: 'zh-CN' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('../lib/mode-store', () => ({
  useModeStore: { getState: () => ({ serverUrl: null }) },
}));

vi.mock('../lib/sanitize-html', () => ({
  sanitizeHtml: (h: string) => h,
}));

vi.mock('../lib/image-store', () => ({
  replaceMissingImageRefs: (s: string) => s,
}));

vi.mock('../lib/error-text', () => ({
  errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => createElement('span', { 'data-icon': name }, name),
}));

// 通过 hoisted 共享 mock 函数引用，方便在 test 体内用 vi.mocked() 调整行为
const { isCiphertextMock, decryptStringMock } = vi.hoisted(() => {
  const isCiphertextMock = vi.fn(() => true);
  const decryptStringMock = vi.fn(async () =>
    JSON.stringify({ title: 'Shared', content: 'Hello' })
  );
  return { isCiphertextMock, decryptStringMock };
});

vi.mock('@dustnote/shared', async () => {
  const actual = await vi.importActual<typeof import('@dustnote/shared')>('@dustnote/shared');
  // 明确覆盖：先复制 actual 的所有属性，再用我们的 mock 覆盖关键函数
  const mod: Record<string, unknown> = { ...actual };
  mod.isCiphertext = isCiphertextMock;
  mod.decryptString = decryptStringMock;
  return mod as typeof actual;
});

import { PublicShareView } from './PublicShareView';

const originalLocation = window.location;

function setHash(value: string) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hash: value },
    configurable: true,
    writable: true,
  });
}

function makeFetch(status: number, body: Record<string, unknown> = {}) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

const HASH32 = '#' + Buffer.alloc(32).toString('base64url');

describe('PublicShareView fetchShare 状态机', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    isCiphertextMock.mockReset();
    isCiphertextMock.mockReturnValue(true);
    decryptStringMock.mockReset();
    decryptStringMock.mockResolvedValue(JSON.stringify({ title: 'Shared', content: 'Hello' }));
  });
  afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
      writable: true,
    });
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('password_required：401 → 渲染密码输入框', async () => {
    setHash(HASH32);
    vi.stubGlobal('fetch', makeFetch(401, { error: 'password_required' }));
    const r = render(createElement(PublicShareView, { token: 'tok' } as never));
    await vi.waitFor(() => {
      expect(r.container.querySelector('input[type="password"]')).toBeTruthy();
    });
  });

  it('invalid_password：401 → error 文案', async () => {
    setHash(HASH32);
    vi.stubGlobal('fetch', makeFetch(401, { error: 'invalid_password' }));
    const r = render(createElement(PublicShareView, { token: 'tok' } as never));
    await vi.waitFor(() => {
      expect(r.container.textContent).toMatch(/public_share\.wrong_password/);
    });
  });

  it('423 锁定 → error', async () => {
    setHash(HASH32);
    vi.stubGlobal('fetch', makeFetch(423, { message: 'locked 15min' }));
    const r = render(createElement(PublicShareView, { token: 'tok' } as never));
    await vi.waitFor(() => {
      expect(r.container.textContent).toContain('locked 15min');
    });
  });

  it('410 过期 → error', async () => {
    setHash(HASH32);
    vi.stubGlobal('fetch', makeFetch(410, { message: 'expired' }));
    const r = render(createElement(PublicShareView, { token: 'tok' } as never));
    await vi.waitFor(() => {
      expect(r.container.textContent).toContain('expired');
    });
  });

  it('500 → load_fail error', async () => {
    setHash(HASH32);
    vi.stubGlobal('fetch', makeFetch(500, {}));
    const r = render(createElement(PublicShareView, { token: 'tok' } as never));
    await vi.waitFor(() => {
      expect(r.container.textContent).toMatch(/public_share\.load_fail/);
    });
  });

  it('link_incomplete：成功但无 shareKey → error', async () => {
    setHash(''); // 无 hash
    vi.stubGlobal('fetch', makeFetch(200, { ciphertext: { v: 1, k: 1, n: 'a', c: 'b' } }));
    const r = render(createElement(PublicShareView, { token: 'tok' } as never));
    await vi.waitFor(() => {
      expect(r.container.textContent).toMatch(/public_share\.link_incomplete/);
    });
  });

  it('ready：成功解密 → 渲染 title + content', async () => {
    setHash(HASH32);
    vi.stubGlobal(
      'fetch',
      makeFetch(200, {
        ciphertext: { v: 1, k: 1, n: 'a'.repeat(24), c: 'b'.repeat(24) },
        createdAt: '2026-01-01',
        expiresAt: null,
      })
    );
    const r = render(createElement(PublicShareView, { token: 'tok' } as never));
    await vi.waitFor(() => {
      expect(r.container.textContent).toContain('Shared');
      expect(r.container.textContent).toContain('Hello');
    });
  });

  it('loading：fetch 挂起时先渲染 loading', async () => {
    setHash(HASH32);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );
    const r = render(createElement(PublicShareView, { token: 'tok' } as never));
    expect(r.container.textContent).toMatch(/public_share\.loading/);
  });

  it('ready + hasPassword：密码提交成功 → 渲染 password_protected badge', async () => {
    setHash(HASH32);
    const fn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'password_required' }),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ciphertext: { v: 1, k: 1, n: 'a'.repeat(24), c: 'b'.repeat(24) },
          createdAt: '2026-01-01',
          expiresAt: null,
        }),
      });
    vi.stubGlobal('fetch', fn);
    const r = render(createElement(PublicShareView, { token: 'tok' } as never));
    await vi.waitFor(() => {
      expect(r.container.querySelector('input[type="password"]')).toBeTruthy();
    });
    const { fireEvent } = await import('../test/render');
    const input = r.container.querySelector('input[type="password"]') as HTMLInputElement;
    // 第二参必须是纯字符串：助手走原型链 setter，传对象会把 "[object Object]"
    // 写进密码框——之前正是这样，密码路径其实从未被真正测过。
    fireEvent.change(input, 'mypwd');
    const btn = Array.from(r.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('public_share.unlock')
    ) as HTMLButtonElement;
    fireEvent.click(btn);
    await vi.waitFor(
      () => {
        expect(r.container.textContent).toContain('Shared');
      },
      { timeout: 5000 }
    );
    expect(r.container.textContent).toMatch(/public_share\.password_protected/);
  });

  it('bad_data：ciphertext 缺关键字段 → bad_data error（mock isCiphertext 拒绝）', async () => {
    setHash(HASH32);
    isCiphertextMock.mockReturnValue(false);
    vi.stubGlobal('fetch', makeFetch(200, { ciphertext: { v: 'invalid' } as never }));
    const r = render(createElement(PublicShareView, { token: 'tok' } as never));
    await vi.waitFor(() => {
      expect(r.container.textContent).toMatch(/public_share\.bad_data/);
    });
  });

  it('decrypt_fail：decryptString 抛错 → error 文案', async () => {
    setHash(HASH32);
    decryptStringMock.mockRejectedValueOnce(new Error('boom'));
    vi.stubGlobal(
      'fetch',
      makeFetch(200, {
        ciphertext: { v: 1, k: 1, n: 'a'.repeat(24), c: 'b'.repeat(24) },
        createdAt: '2026-01-01',
        expiresAt: null,
      })
    );
    const r = render(createElement(PublicShareView, { token: 'tok' } as never));
    await vi.waitFor(() => {
      expect(r.container.textContent).toMatch(/public_share\.decrypt_fail/);
    });
  });

  it('fetch throw → catch-all error（L135）', async () => {
    setHash(HASH32);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down')))
    );
    const r = render(createElement(PublicShareView, { token: 'tok' } as never));
    await vi.waitFor(() => {
      // catch-all 走 errorText(err) → "network down"
      expect(r.container.textContent).toContain('network down');
    });
  });

  it('onKeyDown Enter + 非空 password → fetchShare 被调用（覆盖 L175-176）', async () => {
    setHash(HASH32);
    const fn = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: async () => ({ error: 'password_required' }),
      })
    );
    vi.stubGlobal('fetch', fn);
    const r = render(createElement(PublicShareView, { token: 'tok' } as never));
    await vi.waitFor(() => {
      expect(r.container.querySelector('input[type="password"]')).toBeTruthy();
    });
    const { fireEvent } = await import('../test/render');
    const input = r.container.querySelector('input[type="password"]') as HTMLInputElement;
    // 关键：用正确的 fireEvent.change(el, value) 签名（走原生 setter 触发 React onChange）
    fireEvent.change(input, 'k');
    const callsBefore = fn.mock.calls.length;
    fireEvent.keyDown(input, 'Enter');
    await vi.waitFor(() => {
      expect(fn.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
