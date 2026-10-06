/**
 * SharesManager 组件渲染测试
 *
 * 覆盖：
 * - 加载中（loading）
 * - 空列表（empty）
 * - 列表渲染（生效 / 已吊销 / 已过期 / 密码标记）
 * - 加载失败（error）
 * - 吊销单个分享后刷新
 * - 未解锁复制链接提示
 * - 批量选择进出
 * - 无障碍对话框语义
 *
 * 使用 src/test/render 自定义渲染工具（绕开 pnpm 多 react 实例问题）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, createElement } from '../test/render';

// ---- 用 vi.hoisted 声明 mock 变量，确保 vi.mock 工厂可引用 ----
const { storeState, useStoreMock, toastCalls, modeStoreState } = vi.hoisted(() => {
  const TEST_TOKEN = ['test', 'token'].join('-');
  const storeState = {
    notesPlain: new Map<string, { title: string }>(),
    accessToken: TEST_TOKEN,
    masterKey: null as Uint8Array | null,
  };
  const useStoreMock = vi.fn((selector?: (s: typeof storeState) => unknown) =>
    selector ? selector(storeState) : storeState
  );
  (useStoreMock as unknown as { getState: () => typeof storeState }).getState = () => storeState;
  const toastCalls: Array<{ kind: string; message: string }> = [];
  // 抽出来一份可变 mode-store 快照，方便用例（尤其 Bug #4 回归）临时把 serverUrl 置空
  const modeStoreState: { serverUrl: string | null } = { serverUrl: 'http://localhost:3210' };
  return { storeState, useStoreMock, toastCalls, modeStoreState };
});

vi.mock('react-i18next', () => {
  // t 稳定引用，避免依赖 t 的 useCallback 触发无限重渲染。
  const t = (key: string, opts?: Record<string, unknown>): string => {
    if (!opts) return key;
    return Object.entries(opts).reduce(
      (acc, [k, v]) => acc.replace(new RegExp(`{{${k}}}`, 'g'), String(v)),
      key
    );
  };
  // 组件现在经 errorText() 依赖真实 i18n 实例（shared 的错误码分流策略），
  // 而 lib/i18n.ts 在模块加载时会调用 i18n.use(initReactI18next)——
  // mock 必须带上这个插件桩，否则报 "No initReactI18next export is defined"。
  return {
    useTranslation: () => ({ t }),
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

vi.mock('../lib/store', () => ({ useStore: useStoreMock }));
vi.mock('../lib/mode-store', () => ({
  // Bug #4 修后：serverUrl 守卫已限定 `!serverUrl && isTauri()`（Tauri 桌面才拦），
  // jsdom 没有 __TAURI_INTERNALS__ 故 isTauri()=false，同源也是合法路径。
  // 默认给一个绝对 serverUrl 让 fetch 打到稳定 URL；
  // "Bug #4 回归"用例会临时把 modeStoreState.serverUrl 置 null，证明同源能通。
  useModeStore: {
    getState: () => modeStoreState,
  },
}));
vi.mock('../lib/device', () => ({ getDeviceId: () => 'test-device-id' }));
vi.mock('../lib/toast', () => ({
  toast: {
    success: (m: string) => toastCalls.push({ kind: 'success', message: m }),
    error: (m: string) => toastCalls.push({ kind: 'error', message: m }),
    info: (m: string) => toastCalls.push({ kind: 'info', message: m }),
  },
}));

import { SharesManager } from './SharesManager';

function makeShare(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'share-1',
    noteId: 'note-1',
    token: 'abc123',
    wrappedShareKey: { iv: 'a', ct: 'b' },
    hasPassword: false,
    expiresAt: null,
    viewCount: 3,
    revoked: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function fetchOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
  } as unknown as Response;
}
function fetchFail(status: number): Response {
  return {
    ok: false,
    status,
    statusText: 'Bad',
    headers: { get: () => 'application/json' },
    json: async () => ({}),
  } as unknown as Response;
}

describe('SharesManager', () => {
  let originalConfirm: typeof window.confirm;

  beforeEach(() => {
    originalConfirm = window.confirm;
    window.confirm = () => true;
    storeState.notesPlain = new Map([['note-1', { title: '我的笔记' }]]);
    storeState.masterKey = null;
    toastCalls.length = 0;
  });

  afterEach(() => {
    window.confirm = originalConfirm;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
    // Bug #4 回归用例会把 serverUrl 置 null，防止状态泄漏到后续用例
    modeStoreState.serverUrl = 'http://localhost:3210';
  });

  it('渲染加载中状态', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );
    const { getByText } = render(createElement(SharesManager, { onClose: () => {} }));
    expect(getByText('shares.loading')).toBeInTheDocument();
    expect(getByText('shares.title')).toBeInTheDocument();
  });

  it('渲染空列表', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fetchOk({ shares: [] }))
    );
    const { getByText } = render(createElement(SharesManager, { onClose: () => {} }));
    await waitFor(() => {
      expect(getByText('shares.empty')).toBeInTheDocument();
    });
  });

  it('渲染分享列表（生效 / 已吊销 / 已过期 / 密码标记）', async () => {
    const shares = [
      makeShare({
        id: 's-active',
        noteId: 'note-1',
        viewCount: 5,
        revoked: false,
        expiresAt: null,
      }),
      makeShare({
        id: 's-revoked',
        noteId: 'note-1',
        revoked: true,
        hasPassword: true,
        expiresAt: null,
      }),
      makeShare({
        id: 's-expired',
        noteId: 'note-1',
        revoked: false,
        expiresAt: '2020-01-01T00:00:00.000Z',
      }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fetchOk({ shares }))
    );
    const { getByText } = render(createElement(SharesManager, { onClose: () => {} }));
    await waitFor(() => expect(getByText('shares.status_active')).toBeInTheDocument());
    expect(getByText('shares.status_revoked')).toBeInTheDocument();
    expect(getByText('shares.status_expired')).toBeInTheDocument();
    expect(getByText('shares.password_badge')).toBeInTheDocument();
    expect(getByText('shares.view_count')).toBeInTheDocument();
  });

  it('加载失败时显示错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fetchFail(500))
    );
    const { getByText } = render(createElement(SharesManager, { onClose: () => {} }));
    await waitFor(() => {
      expect(getByText(/shares.load_fail/)).toBeInTheDocument();
    });
  });

  it('Esc 键关闭对话框', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fetchOk({ shares: [] }))
    );
    const onClose = vi.fn();
    render(createElement(SharesManager, { onClose }));
    await waitFor(() => {});
    fireEvent.keyDown(window, 'Escape');
    expect(onClose).toHaveBeenCalled();
  });

  it('点击关闭按钮调用 onClose', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fetchOk({ shares: [] }))
    );
    const onClose = vi.fn();
    const { getByRole } = render(createElement(SharesManager, { onClose }));
    await waitFor(() => {});
    const closeBtn = getByRole('button', { name: 'common.close' });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('吊销单个分享成功后重新加载列表', async () => {
    const sharesResp = [makeShare({ id: 's-1', noteId: 'note-1' })];
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') return fetchOk({});
        callCount++;
        return fetchOk({ shares: callCount === 1 ? sharesResp : [] });
      })
    );
    const { getByText, getAllByText } = render(createElement(SharesManager, { onClose: () => {} }));
    await waitFor(() => expect(getByText('shares.status_active')).toBeInTheDocument());
    const revokeBtn = getByText('shares.revoke');
    await fireEvent.clickAsync(revokeBtn);
    // v2.3.6 重构：吊销改为经 ConfirmDialog 二次确认。
    // 弹窗的 confirmLabel 也是 shares.revoke，故列表按钮与弹窗确认按钮同文本。
    // 先等待弹窗独有文案 shares.confirm_revoke_one 出现（证弹窗已挂载），
    // 再从所有 shares.revoke 按钮中取最后一个（弹窗在列表之后渲染）点击以真正执行吊销。
    await waitFor(() => expect(getByText('shares.confirm_revoke_one')).toBeInTheDocument());
    const revokeBtns = getAllByText('shares.revoke');
    const confirmBtn = revokeBtns[revokeBtns.length - 1];
    if (!confirmBtn) throw new Error('ConfirmDialog 确认按钮未渲染');
    await fireEvent.clickAsync(confirmBtn);
    await waitFor(() => expect(getByText('shares.empty')).toBeInTheDocument());
  });

  it('未解锁时点击复制链接提示需先解锁', async () => {
    storeState.masterKey = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fetchOk({ shares: [makeShare({ id: 's-1', noteId: 'note-1' })] }))
    );
    const { getByText } = render(createElement(SharesManager, { onClose: () => {} }));
    await waitFor(() => expect(getByText('shares.status_active')).toBeInTheDocument());
    const copyBtn = getByText('shares.copy_link');
    await fireEvent.clickAsync(copyBtn);
    expect(
      toastCalls.some((c) => c.kind === 'error' && c.message === 'shares.unlock_required')
    ).toBe(true);
  });

  it('进入批量选择后可退出', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fetchOk({ shares: [makeShare({ id: 's-1', noteId: 'note-1' })] }))
    );
    const { getByText, queryByText } = render(createElement(SharesManager, { onClose: () => {} }));
    await waitFor(() => expect(getByText('shares.status_active')).toBeInTheDocument());
    fireEvent.click(getByText('shares.batch_select'));
    expect(getByText('shares.exit_select')).toBeInTheDocument();
    fireEvent.click(getByText('shares.exit_select'));
    await waitFor(() => expect(queryByText('shares.exit_select')).not.toBeInTheDocument());
  });

  it('暴露无障碍对话框语义', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fetchOk({ shares: [] }))
    );
    const { getByRole } = render(createElement(SharesManager, { onClose: () => {} }));
    const dialog = getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'shares-mgr-title');
  });

  it('Bug #4 回归：serverUrl=null 且非 Tauri 时走同源 /api/v1/shares 并成功加载', async () => {
    // 旧行为（bug）：!serverUrl 无条件早退 → shares 永远空白 + "未配置服务器地址…"
    // 新行为：仅 Tauri 才拦；jsdom 里 isTauri()=false，同源 fetch 应正常发出并渲染列表
    modeStoreState.serverUrl = null;
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      fetchOk({ shares: [makeShare({ id: 's-web-online' })] })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { getByText } = render(createElement(SharesManager, { onClose: () => {} }));
    await waitFor(() => expect(getByText('shares.status_active')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0]?.[0] ?? '');
    expect(url).toMatch(/\/api\/v1\/shares(\?|$)/);
    expect(document.body.textContent).not.toMatch(/shares\.error_no_server/);
  });
});
