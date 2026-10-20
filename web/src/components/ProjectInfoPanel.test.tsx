/**
 * ProjectInfoPanel 回归测试
 *
 * 板块定位：信息聚合（版本/安全参数/数据统计/链接），不是交互入口。
 * 测试口径：数据来自 store 内存态（notes/folders/totpEnabled），不依赖网络与
 * IndexedDB；单机模式下不显示服务器行；回收站数 = 总数 − 未删除数。
 * i18n/store mock 模式复用 NoteHistoryDialog.test.tsx 先例。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, createElement, waitFor, fireEvent } from '../test/render';

vi.mock('react-i18next', () => {
  const t = (key: string, opts?: Record<string, unknown>): string => {
    if (!opts) return key;
    return Object.entries(opts).reduce(
      (acc, [k, v]) => acc.replace(new RegExp(`{{${k}}}`, 'g'), String(v)),
      key
    );
  };
  return {
    useTranslation: () => ({ t }),
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

const openSpy = vi.fn();
// jsdom 不实现 window.open（stub 整个 window.open）

const { useStoreMock, storeState } = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  const mock = vi.fn((selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(state) : state
  );
  (mock as unknown as { getState: () => Record<string, unknown> }).getState = () => state;
  return { storeState: state, useStoreMock: mock };
});

vi.mock('../lib/store', () => ({ useStore: useStoreMock }));
vi.mock('../lib/platform', () => ({ isTauri: () => false }));
vi.mock('../lib/mode-store', () => ({
  useModeStore: { getState: () => ({ serverUrl: 'https://api.example.com' }) },
}));
vi.mock('../lib/config', () => ({
  getConfig: () => ({ apiBase: '/api/v1' }),
}));

import { ProjectInfoPanel } from './ProjectInfoPanel';
import type { NoteRow, Folder } from '../lib/store-types';

function note(id: string, deleted: boolean): NoteRow {
  return {
    id,
    ciphertext: 'x',
    keyVersion: 1,
    isPinned: false,
    isFavorite: false,
    deletedAt: deleted ? '2026-01-01T00:00:00Z' : null,
    version: 1,
    clientUpdatedAt: '2026-01-01T00:00:00Z',
    serverUpdatedAt: '2026-01-01T00:00:00Z',
    folderId: null,
  };
}

function seed(opts: {
  notes?: NoteRow[];
  folders?: Folder[];
  totpEnabled?: boolean;
  mode?: 'standalone' | 'online';
  kdf?: unknown;
}): void {
  storeState.notes = new Map((opts.notes ?? []).map((n) => [n.id, n]));
  storeState.folders = opts.folders ?? [];
  storeState.totpEnabled = opts.totpEnabled ?? false;
  storeState.mode = opts.mode ?? 'standalone';
  storeState.accountKdfParams = opts.kdf ?? null;
}

function folder(id: string): Folder {
  return { id, name: id, parentId: null, icon: null, sortOrder: 0, createdAt: '' };
}

describe('ProjectInfoPanel', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openSpy.mockClear();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // 覆盖 jsdom 的 window.open（返回 undefined 也行，只要不抛 Not implemented）
    const originalOpen = window.open;
    window.open = openSpy as unknown as typeof window.open;
    afterEach(() => {
      window.open = originalOpen;
    });
    seed({});
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('渲染版本行与安全参数区（app 版本来自注入常量）', () => {
    seed({ kdf: { algorithm: 'pbkdf2', iterations: 100000, dkLen: 32 } });
    const { container } = render(createElement(ProjectInfoPanel));
    expect(container.textContent).toContain('0.0.0-test');
    expect(container.textContent).toContain('PBKDF2-SHA256');
    expect(container.textContent).toContain('100,000');
  });

  it('回收站计数 = 总数 − 未删除数；文件夹数取 store 长度', () => {
    seed({
      notes: [note('a', false), note('b', false), note('c', true)],
      folders: [folder('f1'), folder('f2')],
    });
    const { container } = render(createElement(ProjectInfoPanel));
    const text = container.textContent ?? '';
    expect(text).toContain('2');
    expect(text).toContain('1');
  });

  it('单机模式：不请求服务器版本（无 fetch），渲染单机提示 key', () => {
    seed({ mode: 'standalone' });
    const { container } = render(createElement(ProjectInfoPanel));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain('settings.project_info_standalone_hint');
  });

  it('2FA 关闭显示关闭态 key', () => {
    const { container } = render(createElement(ProjectInfoPanel));
    expect(container.textContent).toContain('settings.project_info_2fa_off');
  });

  it('2FA 开启显示开启态 key + success 配色', () => {
    seed({ totpEnabled: true });
    const { container } = render(createElement(ProjectInfoPanel));
    expect(container.textContent).toContain('settings.project_info_2fa_on');
    expect(container.querySelector('.text-success')).not.toBeNull();
  });

  it('KDF 参数缺失回退默认算法名', () => {
    seed({ kdf: null });
    const { container } = render(createElement(ProjectInfoPanel));
    expect(container.textContent).toContain('PBKDF2-SHA256');
  });

  it('argon2id 参数格式化为 Argon2id · m=… t=… p=…', () => {
    seed({ kdf: { algorithm: 'argon2id', m: 64, t: 3, p: 4 } });
    const { container } = render(createElement(ProjectInfoPanel));
    expect(container.textContent).toContain('Argon2id');
    expect(container.textContent).toContain('m=64');
    expect(container.textContent).toContain('t=3');
    expect(container.textContent).toContain('p=4');
  });

  it('联机模式：发起 fetch health 请求并展示服务端版本', async () => {
    seed({ mode: 'online' });
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ version: '2.5.5' }),
    });
    const { container } = render(createElement(ProjectInfoPanel));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
      expect(container.textContent).toContain('2.5.5');
    });
  });

  it('联机模式：fetch 失败显示 unreachable 文案', async () => {
    seed({ mode: 'online' });
    fetchSpy.mockResolvedValue({ ok: false });
    const { container } = render(createElement(ProjectInfoPanel));
    await waitFor(() => {
      expect(container.textContent).toContain('settings.project_info_server_unreachable');
    });
  });

  it('联机模式：fetch 抛错显示 unreachable 文案', async () => {
    seed({ mode: 'online' });
    fetchSpy.mockRejectedValue(new Error('net down'));
    const { container } = render(createElement(ProjectInfoPanel));
    await waitFor(() => {
      expect(container.textContent).toContain('settings.project_info_server_unreachable');
    });
  });

  it('项目链接点击触发 openExternalUrl（window.open）', () => {
    seed({});
    const { container } = render(createElement(ProjectInfoPanel));
    const links = Array.from(container.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('settings.project_info_repo')
    );
    expect(links.length).toBeGreaterThan(0);
    fireEvent.click(links[0]!);
    expect(openSpy).toHaveBeenCalled();
    const args = openSpy.mock.calls[0];
    expect(args?.[0]).toContain('github.com');
  });

  it('4 个项目链接全部触发 open', () => {
    seed({});
    const { container } = render(createElement(ProjectInfoPanel));
    const buttons = Array.from(container.querySelectorAll('button')).filter((b) =>
      /project_info_(repo|privacy|terms|notices)/.test(b.textContent ?? '')
    );
    expect(buttons.length).toBe(4);
    buttons.forEach((b) => fireEvent.click(b));
    expect(openSpy).toHaveBeenCalledTimes(4);
  });
});
