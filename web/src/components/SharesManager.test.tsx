/**
 * SharesManager 组件渲染测试
 *
 * 覆盖：
 *  - 加载中（loading）
 *  - 空列表（empty）
 *  - 列表渲染（生效 / 已吊销 / 已过期 / 密码标记）
 *  - 加载失败（error）
 *  - 吊销单个分享后刷新
 *  - 未解锁复制链接提示
 *  - 批量选择进出
 *  - 无障碍对话框语义
 *
 * 使用 src/test/render 自定义渲染工具（绕开 pnpm 多 react 实例问题）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, createElement } from '../test/render';

// ---- 用 vi.hoisted 声明 mock 变量，确保 vi.mock 工厂可引用 ----
const { storeState, useStoreMock, toastCalls } = vi.hoisted(() => {
  const storeState = {
    notesPlain: new Map<string, { title: string }>(),
    accessToken: 'test-token',
    masterKey: null as Uint8Array | null,
  };
  const useStoreMock = vi.fn((selector?: (s: typeof storeState) => unknown) =>
    selector ? selector(storeState) : storeState
  );
  (useStoreMock as unknown as { getState: () => typeof storeState }).getState = () => storeState;
  const toastCalls: Array<{ kind: string; message: string }> = [];
  return { storeState, useStoreMock, toastCalls };
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
  return { useTranslation: () => ({ t }) };
});

vi.mock('../lib/store', () => ({ useStore: useStoreMock }));
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
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function fetchFail(status: number): Response {
  return { ok: false, status, statusText: 'Bad', json: async () => ({}) } as unknown as Response;
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
  });

  it('渲染加载中状态', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { getByText } = render(createElement(SharesManager, { onClose: () => {} }));
    expect(getByText('shares.loading')).toBeInTheDocument();
    expect(getByText('shares.title')).toBeInTheDocument();
  });

  it('渲染空列表', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fetchOk({ shares: [] })));
    const { getByText } = render(createElement(SharesManager, { onClose: () => {} }));
    await waitFor(() => {
      expect(getByText('shares.empty')).toBeInTheDocument();
    });
  });

  it('渲染分享列表（生效 / 已吊销 / 已过期 / 密码标记）', async () => {
    const shares = [
      makeShare({ id: 's-active', noteId: 'note-1', viewCount: 5, revoked: false, expiresAt: null }),
      makeShare({ id: 's-revoked', noteId: 'note-1', revoked: true, hasPassword: true, expiresAt: null }),
      makeShare({ id: 's-expired', noteId: 'note-1', revoked: false, expiresAt: '2020-01-01T00:00:00.000Z' }),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => fetchOk({ shares })));
    const { getByText } = render(createElement(SharesManager, { onClose: () => {} }));
    await waitFor(() => expect(getByText('shares.status_active')).toBeInTheDocument());
    expect(getByText('shares.status_revoked')).toBeInTheDocument();
    expect(getByText('shares.status_expired')).toBeInTheDocument();
    expect(getByText('shares.password_badge')).toBeInTheDocument();
    expect(getByText('shares.view_count')).toBeInTheDocument();
  });

  it('加载失败时显示错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fetchFail(500)));
    const { getByText } = render(createElement(SharesManager, { onClose: () => {} }));
    await waitFor(() => {
      expect(getByText(/shares.load_fail/)).toBeInTheDocument();
    });
  });

  it('Esc 键关闭对话框', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fetchOk({ shares: [] })));
    const onClose = vi.fn();
    render(createElement(SharesManager, { onClose }));
    await waitFor(() => {});
    fireEvent.keyDown(window, 'Escape');
    expect(onClose).toHaveBeenCalled();
  });

  it('点击关闭按钮调用 onClose', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fetchOk({ shares: [] })));
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
    const { getByText } = render(createElement(SharesManager, { onClose: () => {} }));
    await waitFor(() => expect(getByText('shares.status_active')).toBeInTheDocument());
    const revokeBtn = getByText('shares.revoke');
    await fireEvent.clickAsync(revokeBtn);
    await waitFor(() => expect(getByText('shares.empty')).toBeInTheDocument());
  });

  it('未解锁时点击复制链接提示需先解锁', async () => {
    storeState.masterKey = null;
    vi.stubGlobal('fetch', vi.fn(async () => fetchOk({ shares: [makeShare({ id: 's-1', noteId: 'note-1' })] })));
    const { getByText } = render(createElement(SharesManager, { onClose: () => {} }));
    await waitFor(() => expect(getByText('shares.status_active')).toBeInTheDocument());
    const copyBtn = getByText('shares.copy_link');
    await fireEvent.clickAsync(copyBtn);
    expect(toastCalls.some((c) => c.kind === 'error' && c.message === 'shares.unlock_required')).toBe(true);
  });

  it('进入批量选择后可退出', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fetchOk({ shares: [makeShare({ id: 's-1', noteId: 'note-1' })] })));
    const { getByText, queryByText } = render(createElement(SharesManager, { onClose: () => {} }));
    await waitFor(() => expect(getByText('shares.status_active')).toBeInTheDocument());
    fireEvent.click(getByText('shares.batch_select'));
    expect(getByText('shares.exit_select')).toBeInTheDocument();
    fireEvent.click(getByText('shares.exit_select'));
    await waitFor(() => expect(queryByText('shares.exit_select')).not.toBeInTheDocument());
  });

  it('暴露无障碍对话框语义', () => {
    vi.stubGlobal('fetch', vi.fn(async () => fetchOk({ shares: [] })));
    const { getByRole } = render(createElement(SharesManager, { onClose: () => {} }));
    const dialog = getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'shares-mgr-title');
  });
});
