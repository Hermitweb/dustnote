/**
 * NoteHistoryDialog 组件渲染测试
 *
 * 覆盖：
 *  - 版本列表加载（loading / empty / 列表渲染）
 *  - 版本预览（解密成功 / 解密失败）
 *  - 恢复成功提示
 *  - 加载失败错误展示
 *  - 恢复按钮禁用态
 *  - 关闭交互
 *
 * 使用 src/test/render 自定义渲染工具（绕开 pnpm 多 react 实例问题）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, createElement } from '../test/render';

const { useStoreMock, decryptMock } = vi.hoisted(() => {
  const storeState = {
    accessToken: 'test-token',
    masterKey: new Uint8Array([1, 2, 3]) as unknown as CryptoKey,
  };
  const useStoreMock = vi.fn();
  (useStoreMock as unknown as { getState: () => typeof storeState }).getState = () => storeState;
  const decryptMock = vi.fn();
  return { storeState, useStoreMock, decryptMock };
});

vi.mock('react-i18next', () => {
  // t 必须是稳定引用：NoteHistoryDialog 的 useCallback 依赖 t，
  // 若每次渲染返回新函数会触发无限重渲染 → act() 挂起。
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
vi.mock('@dustnote/shared', () => ({ decryptString: decryptMock }));
vi.mock('marked', () => ({ marked: { parse: (s: string) => s } }));

import { NoteHistoryDialog } from './NoteHistoryDialog';

function makeVersion(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'v-1', noteVersion: 3, createdAt: '2026-07-15T00:00:00.000Z', ...overrides };
}

function fetchOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  } as unknown as Response;
}
function fetchFail(status: number): Response {
  return {
    ok: false,
    status,
    statusText: 'Err',
    headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
    json: async () => ({ message: 'boom' }),
  } as unknown as Response;
}

describe('NoteHistoryDialog', () => {
  let originalConfirm: typeof window.confirm;

  beforeEach(() => {
    originalConfirm = window.confirm;
    window.confirm = () => true;
    decryptMock.mockReset();
  });

  afterEach(() => {
    window.confirm = originalConfirm;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
  });

  it('渲染加载中状态', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { getByText } = render(createElement(NoteHistoryDialog, { noteId: 'n1', currentVersion: 1, onClose: () => {} }));
    expect(getByText('history.title')).toBeInTheDocument();
  });

  it('渲染空历史版本', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fetchOk({ versions: [] })));
    const { getByText } = render(createElement(NoteHistoryDialog, { noteId: 'n1', currentVersion: 1, onClose: () => {} }));
    await waitFor(() => expect(getByText('history.empty')).toBeInTheDocument());
  });

  it('渲染版本列表并展示版本号', async () => {
    const versions = [makeVersion({ id: 'v-1', noteVersion: 3 }), makeVersion({ id: 'v-2', noteVersion: 2 })];
    vi.stubGlobal('fetch', vi.fn(async () => fetchOk({ versions })));
    const { getAllByText } = render(createElement(NoteHistoryDialog, { noteId: 'n1', currentVersion: 3, onClose: () => {} }));
    await waitFor(() => expect(getAllByText('history.version_label')).toHaveLength(2));
  });

  it('选中版本后解密并预览内容', async () => {
    const versions = [makeVersion({ id: 'v-1', noteVersion: 3 })];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (typeof url === 'string' && url.endsWith('/versions/v-1')) {
          return fetchOk({ ciphertext: JSON.stringify({ iv: 'x', ct: 'y', payload: {} }) });
        }
        return fetchOk({ versions });
      })
    );
    decryptMock.mockResolvedValue(JSON.stringify({ title: '历史标题', content: '# Hello' }));
    const { getByText } = render(createElement(NoteHistoryDialog, { noteId: 'n1', currentVersion: 3, onClose: () => {} }));
    await waitFor(() => expect(getByText('history.version_label')).toBeInTheDocument());
    await fireEvent.clickAsync(getByText('history.version_label'));
    await waitFor(() => {
      expect(getByText('历史标题')).toBeInTheDocument();
      expect(getByText('# Hello')).toBeInTheDocument();
    });
  });

  it('解密失败时显示错误', async () => {
    const versions = [makeVersion({ id: 'v-1', noteVersion: 3 })];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (typeof url === 'string' && url.endsWith('/versions/v-1')) {
          return fetchOk({ ciphertext: JSON.stringify({ payload: {} }) });
        }
        return fetchOk({ versions });
      })
    );
    decryptMock.mockRejectedValue(new Error('decrypt err'));
    const { getByText } = render(createElement(NoteHistoryDialog, { noteId: 'n1', currentVersion: 3, onClose: () => {} }));
    await waitFor(() => expect(getByText('history.version_label')).toBeInTheDocument());
    await fireEvent.clickAsync(getByText('history.version_label'));
    await waitFor(() => expect(getByText(/history.load_fail/)).toBeInTheDocument());
  });

  it('版本列表加载失败显示错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fetchFail(500)));
    const { getByText } = render(createElement(NoteHistoryDialog, { noteId: 'n1', currentVersion: 1, onClose: () => {} }));
    await waitFor(() => expect(getByText(/history.load_fail/)).toBeInTheDocument());
  });

  it('恢复版本成功后显示成功提示', async () => {
    const versions = [makeVersion({ id: 'v-1', noteVersion: 3 })];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && url.includes('/restore')) return fetchOk({ version: 4 });
        if (typeof url === 'string' && url.endsWith('/versions/v-1')) {
          return fetchOk({ ciphertext: JSON.stringify({ payload: {} }) });
        }
        return fetchOk({ versions });
      })
    );
    decryptMock.mockResolvedValue(JSON.stringify({ title: 'T', content: 'C' }));
    const { getByText } = render(createElement(NoteHistoryDialog, { noteId: 'n1', currentVersion: 3, onClose: () => {} }));
    await waitFor(() => expect(getByText('history.version_label')).toBeInTheDocument());
    await fireEvent.clickAsync(getByText('history.version_label'));
    await waitFor(() => expect(getByText('T')).toBeInTheDocument());
    await fireEvent.clickAsync(getByText('history.restore'));
    // v2.3.6 重构：restore 改为经 ConfirmDialog 二次确认，需点击确认按钮才真正执行恢复
    await waitFor(() => expect(getByText('common.confirm')).toBeInTheDocument());
    await fireEvent.clickAsync(getByText('common.confirm'));
    await waitFor(() => expect(getByText('history.restore_success')).toBeInTheDocument());
  });

  it('关闭按钮调用 onClose', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fetchOk({ versions: [] })));
    const onClose = vi.fn();
    const { container } = render(createElement(NoteHistoryDialog, { noteId: 'n1', currentVersion: 1, onClose }));
    await waitFor(() => {});
    const xBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '✕');
    fireEvent.click(xBtn!);
    expect(onClose).toHaveBeenCalled();
  });

  it('未选中版本时恢复按钮禁用', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fetchOk({ versions: [makeVersion()] })));
    const { getByText } = render(createElement(NoteHistoryDialog, { noteId: 'n1', currentVersion: 1, onClose: () => {} }));
    await waitFor(() => expect(getByText('history.version_label')).toBeInTheDocument());
    const restoreBtn = getByText('history.restore').closest('button');
    expect(restoreBtn).toBeDisabled();
  });
});
